// Copyright 2017 Ryan Wick
// Copyright 2022 Anton Korobeynikov
// Copyright 2024 Bandage Layout JS Port

// This file is part of Bandage

// Bandage is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#include "../include/graphlayout.h"
#include "../include/settings.h"

#include "ogdf/basic/GraphCopy.h"
#include "ogdf/basic/simple_graph_alg.h"
#include "ogdf/energybased/FMMMLayout.h"
#include "ogdf/energybased/fmmm/MAARPacking.h"
#include "ogdf/energybased/FastMultipoleEmbedder.h"
#include "ogdf/energybased/fmmm/FMMMOptions.h"

#include <ctime>
#include <cmath>
#include <algorithm>
#include <limits>
#include <set>
#include <unordered_map>
#include <utility>
#include <vector>

using namespace ogdf;
using namespace ogdf::energybased;

// OGDF node storage for layout
using OGDFGraphLayout = std::unordered_map<DeBruijnNode*, std::vector<ogdf::node>>;

// FMM layout implementation
class FMMGraphLayout {
public:
    FMMGraphLayout(int graphLayoutQuality, bool useLinearLayout,
                   double graphLayoutComponentSeparation, double aspectRatio)
        : m_graphLayoutQuality(graphLayoutQuality),
          m_useLinearLayout(useLinearLayout),
          m_graphLayoutComponentSeparation(graphLayoutComponentSeparation),
          m_aspectRatio(aspectRatio) {
        init();
    }

    void init() {
        m_layout.randSeed(clock());
        m_layout.useHighLevelOptions(false);
        m_layout.unitEdgeLength(1.0);
        m_layout.allowedPositions(ogdf::FMMMOptions::AllowedPositions::All);
        m_layout.pageRatio(m_aspectRatio);
        m_layout.minDistCC(m_graphLayoutComponentSeparation);
        m_layout.stepsForRotatingComponents(50);
        m_layout.initialPlacementForces(m_useLinearLayout ?
                                       ogdf::FMMMOptions::InitialPlacementForces::KeepPositions :
                                       ogdf::FMMMOptions::InitialPlacementForces::RandomTime);

        switch (m_graphLayoutQuality) {
            case 0:
                m_layout.fixedIterations(3);
                m_layout.fineTuningIterations(1);
                m_layout.nmPrecision(2);
                break;
            case 1:
                m_layout.fixedIterations(15);
                m_layout.fineTuningIterations(10);
                m_layout.nmPrecision(2);
                break;
            case 2:
                m_layout.fixedIterations(30);
                m_layout.fineTuningIterations(20);
                m_layout.nmPrecision(4);
                break;
            case 3:
                m_layout.fixedIterations(60);
                m_layout.fineTuningIterations(40);
                m_layout.nmPrecision(6);
                break;
            case 4:
                m_layout.fixedIterations(120);
                m_layout.fineTuningIterations(60);
                m_layout.nmPrecision(8);
                break;
        }
    }

    void run(GraphAttributes& GA, const EdgeArray<double>& edges) {
        m_layout.call(GA, edges);
    }

private:
    int m_graphLayoutQuality;
    bool m_useLinearLayout;
    double m_graphLayoutComponentSeparation;
    double m_aspectRatio;
    FMMMLayout m_layout;
};

static void addToOgdfGraph(DeBruijnNode* node,
                          Graph& ogdfGraph, GraphAttributes& GA,
                          EdgeArray<double>& edgeLengths,
                          OGDFGraphLayout& layout,
                          const LayoutSettings* settings,
                          double xPos, double yPos, bool linearLayout) {
    if (layout.find(node) != layout.end() ||
        (node->getReverseComplement() &&
         layout.find(node->getReverseComplement()) != layout.end()))
        return;

    double drawnNodeLength = getDrawnNodeLength(settings, node->getLength());
    int numberOfGraphEdges = getNumberOfOgdfGraphEdges(settings, drawnNodeLength);
    int numberOfGraphNodes = numberOfGraphEdges + 1;
    double drawnLengthPerEdge = drawnNodeLength / numberOfGraphEdges;

    ogdf::node newNode;
    ogdf::node previousNode = nullptr;
    for (int i = 0; i < numberOfGraphNodes; ++i) {
        newNode = ogdfGraph.newNode();
        layout[node].push_back(newNode);

        if (linearLayout) {
            GA.x(newNode) = xPos;
            GA.y(newNode) = yPos;
            xPos += settings->nodeSegmentLength;
        }

        GA.width(newNode) = settings->edgeLength;
        GA.height(newNode) = settings->edgeLength;

        if (i > 0) {
            ogdf::edge newEdge = ogdfGraph.newEdge(previousNode, newNode);
            edgeLengths[newEdge] = drawnLengthPerEdge;
        }

        previousNode = newNode;
    }
}

static void addToOgdfGraph(const DeBruijnEdge* edge,
                          Graph& ogdfGraph, EdgeArray<double>& edgeArray,
                          const OGDFGraphLayout& layout,
                          const LayoutSettings* settings) {
    ogdf::node firstEdgeOgdfNode;
    ogdf::node secondEdgeOgdfNode;

    const auto* startingNode = edge->getStartingNode();
    auto startIt = layout.find(const_cast<DeBruijnNode*>(startingNode));
    auto startRcIt = startingNode->getReverseComplement() ?
                     layout.find(startingNode->getReverseComplement()) : layout.end();

    if (startIt != layout.end())
        firstEdgeOgdfNode = startIt->second.back();
    else if (startRcIt != layout.end())
        firstEdgeOgdfNode = startRcIt->second.front();
    else
        return;

    const auto* endingNode = edge->getEndingNode();
    auto endIt = layout.find(const_cast<DeBruijnNode*>(endingNode));
    auto endRcIt = endingNode->getReverseComplement() ?
                   layout.find(endingNode->getReverseComplement()) : layout.end();

    if (endIt != layout.end())
        secondEdgeOgdfNode = endIt->second.front();
    else if (endRcIt != layout.end())
        secondEdgeOgdfNode = endRcIt->second.back();
    else
        return;

    if (startingNode == endingNode &&
        getNumberOfOgdfGraphEdges(settings,
                                 getDrawnNodeLength(settings, startingNode->getLength())) == 1)
        return;

    ogdf::edge newEdge = ogdfGraph.newEdge(firstEdgeOgdfNode, secondEdgeOgdfNode);
    edgeArray[newEdge] = settings->edgeLength;
}

struct ReferencePathPoint {
    ogdf::node node;
    double targetX;
};

static bool collectReferencePathPoints(
        const AssemblyGraph& graph,
        const std::vector<std::string>& referencePathNodeIds,
        const OGDFGraphLayout& layout,
        const LayoutSettings* settings,
        std::vector<ReferencePathPoint>& points) {
    points.clear();
    double nextNodeX = 0.0;

    for (size_t pathIndex = 0;
         pathIndex < referencePathNodeIds.size();
         ++pathIndex) {
        auto graphNodeIt = graph.nodes.find(referencePathNodeIds[pathIndex]);
        if (graphNodeIt == graph.nodes.end())
            return false;

        DeBruijnNode* pathNode = graphNodeIt->second;
        auto layoutIt = layout.find(pathNode);
        bool reverseSegments = false;

        if (layoutIt == layout.end() && pathNode->getReverseComplement()) {
            layoutIt = layout.find(pathNode->getReverseComplement());
            reverseSegments = layoutIt != layout.end();
        }
        if (layoutIt == layout.end() || layoutIt->second.empty())
            return false;

        const auto& segments = layoutIt->second;
        double drawnNodeLength =
            getDrawnNodeLength(settings, pathNode->getLength());
        double segmentSpacing = segments.size() > 1
            ? drawnNodeLength / static_cast<double>(segments.size() - 1)
            : 0.0;

        for (size_t segmentIndex = 0;
             segmentIndex < segments.size();
             ++segmentIndex) {
            size_t orientedIndex = reverseSegments
                ? segments.size() - segmentIndex - 1
                : segmentIndex;
            ogdf::node segment = segments[orientedIndex];
            points.push_back({
                segment,
                nextNodeX + segmentSpacing * static_cast<double>(segmentIndex),
            });
        }

        nextNodeX += drawnNodeLength;
        if (pathIndex + 1 < referencePathNodeIds.size())
            nextNodeX += settings->edgeLength;
    }

    if (points.empty())
        return false;

    double centerX = (points.front().targetX + points.back().targetX) / 2.0;
    for (auto& point : points)
        point.targetX -= centerX;

    return true;
}

static void determineLinearNodePositions(Graph& ogdfGraph,
                                        GraphAttributes& ogdfGraphAttributes,
                                        EdgeArray<double>& ogdfEdgeLengths,
                                        OGDFGraphLayout& layoutMap,
                                        const AssemblyGraph& graph,
                                        const LayoutSettings* settings) {
    std::vector<DeBruijnNode*> sortedDrawnNodes;

    // Try numeric sorting first
    std::vector<std::pair<int, DeBruijnNode*>> numericallySortedNodes;
    bool successfulIntConversion = true;

    for (const auto& pair : graph.nodes) {
        DeBruijnNode* node = pair.second;
        if (!node->isDrawn())
            continue;

        bool ok;
        int nodeInt = toInt(node->getNameWithoutSign(), &ok);
        if (!ok) {
            successfulIntConversion = false;
            break;
        }
        numericallySortedNodes.push_back({nodeInt, node});
    }

    if (successfulIntConversion) {
        std::sort(numericallySortedNodes.begin(), numericallySortedNodes.end(),
                 [](const auto& a, const auto& b) { return a.first < b.first; });
        for (const auto& entry : numericallySortedNodes)
            sortedDrawnNodes.push_back(entry.second);
    } else {
        // Alphabetical sorting
        for (const auto& pair : graph.nodes) {
            if (pair.second->isDrawn())
                sortedDrawnNodes.push_back(pair.second);
        }
        std::sort(sortedDrawnNodes.begin(), sortedDrawnNodes.end(),
                 [](const DeBruijnNode* a, const DeBruijnNode* b) {
                     return a->getNameWithoutSign() < b->getNameWithoutSign();
                 });
    }

    // Add nodes with initial positions
    std::set<std::pair<long long, long long>> usedStartPositions;
    double lastXPos = 0.0;

    for (auto* node : sortedDrawnNodes) {
        if (layoutMap.find(node) != layoutMap.end() ||
            (node->getReverseComplement() &&
             layoutMap.find(node->getReverseComplement()) != layoutMap.end()))
            continue;

        std::vector<DeBruijnNode*> upstreamNodes = node->getUpstreamNodes();
        for (size_t j = 0; j < upstreamNodes.size(); ++j) {
            DeBruijnNode* upstreamNode = upstreamNodes[j];
            auto it = layoutMap.find(upstreamNode);
            if (it == layoutMap.end())
                continue;

            ogdf::node upstreamEnd = it->second.back();
            double upstreamEndPos = ogdfGraphAttributes.x(upstreamEnd);
            if (j == 0)
                lastXPos = upstreamEndPos;
            else
                lastXPos = std::max(lastXPos, upstreamEndPos);
        }

        double xPos = lastXPos + settings->edgeLength;
        double yPos = 0.0;
        long long intXPos = (long long)(xPos * 100.0);
        long long intYPos = (long long)(yPos * 100.0);

        while (usedStartPositions.find({intXPos, intYPos}) != usedStartPositions.end()) {
            yPos += settings->edgeLength;
            intYPos = (long long)(yPos * 100.0);
        }

        addToOgdfGraph(node, ogdfGraph, ogdfGraphAttributes, ogdfEdgeLengths,
                      layoutMap, settings, xPos, yPos, true);
        usedStartPositions.insert({intXPos, intYPos});
        lastXPos = ogdfGraphAttributes.x(layoutMap[node].back());
    }
}

static void buildGraph(Graph& ogdfGraph,
                      GraphAttributes& ogdfGraphAttributes,
                      EdgeArray<double>& ogdfEdgeLengths,
                      OGDFGraphLayout& layoutMap,
                      const AssemblyGraph& graph,
                      const LayoutSettings* settings,
                      bool useLinearLayout,
                      bool referencePathRequested) {
    if (referencePathRequested) {
        // A specific path will be straightened directly by the relax loop in
        // layoutGraph(); seeding everything else in ID order here would just
        // impose unrelated structure that the reference-path pass then has
        // to fight, so let every node start from FMMM's normal placement.
        for (const auto& pair : graph.nodes) {
            DeBruijnNode* node = pair.second;
            if (!node->isDrawn() ||
                layoutMap.find(node) != layoutMap.end() ||
                (node->getReverseComplement() &&
                 layoutMap.find(node->getReverseComplement()) != layoutMap.end()))
                continue;

            addToOgdfGraph(node, ogdfGraph, ogdfGraphAttributes, ogdfEdgeLengths,
                          layoutMap, settings, 0.0, 0.0, false);
        }
    } else if (useLinearLayout) {
        determineLinearNodePositions(ogdfGraph, ogdfGraphAttributes, ogdfEdgeLengths,
                                    layoutMap, graph, settings);
    } else {
        for (const auto& pair : graph.nodes) {
            DeBruijnNode* node = pair.second;
            if (!node->isDrawn() ||
                layoutMap.find(node) != layoutMap.end() ||
                (node->getReverseComplement() &&
                 layoutMap.find(node->getReverseComplement()) != layoutMap.end()))
                continue;

            addToOgdfGraph(node, ogdfGraph, ogdfGraphAttributes, ogdfEdgeLengths,
                          layoutMap, settings, 0.0, 0.0, false);
        }
    }

    // Add edges
    for (const DeBruijnEdge* edge : graph.edges) {
        if (!edge->isDrawn())
            continue;

        if (edge->getOverlapType() == JUMP || edge->getOverlapType() == EXTRA_LINK)
            continue;

        addToOgdfGraph(edge, ogdfGraph, ogdfEdgeLengths, layoutMap, settings);
    }
}

// Straightens the reference path and lays out everything else attached to it.
// The path's own coordinates are fully determined analytically (evenly spaced
// along a straight line) and never touch FMMM at all. Only the *branches*
// hanging off the path need force-directed placement, and each branch is
// relaxed in its own small, freshly-built graph containing just its own nodes
// plus the specific path node(s) it attaches to - not the whole path.
// Including every path node in one shared force system would turn a long
// straight run into a dense wall of fixed points whose combined repulsion
// pushes attached branches far away from their real attachment point, an
// effect that gets worse with a longer path and doesn't improve with more
// relax rounds. (GraphCopy::initByNodes can't be used for this: it requires
// the given node set to be closed under adjacency, which excluding
// pass-through path nodes deliberately violates.)
static void runReferencePathRelax(
        GraphAttributes& GA,
        const EdgeArray<double>& edgeLengths,
        const List<ogdf::node>& componentNodes,
        const std::vector<ReferencePathPoint>& pathPoints,
        int graphLayoutQuality,
        double componentSeparation,
        double aspectRatio,
        int relaxRounds) {
    std::unordered_map<ogdf::node, double> targetXByNode;
    for (const auto& point : pathPoints)
        targetXByNode[point.node] = point.targetX;

    // Path nodes always get their exact analytical position; branches get
    // relaxed below.
    for (const auto& point : pathPoints) {
        GA.x(point.node) = point.targetX;
        GA.y(point.node) = 0.0;
    }

    // Group non-path nodes into clusters connected via non-path edges, along
    // with the set of path nodes each cluster actually attaches to.
    std::unordered_map<ogdf::node, int> clusterOf;
    std::vector<std::vector<ogdf::node>> clusterNodes;
    std::vector<std::set<ogdf::node>> clusterAnchors;

    for (ogdf::node start : componentNodes) {
        if (targetXByNode.count(start) || clusterOf.count(start))
            continue;

        int clusterId = static_cast<int>(clusterNodes.size());
        clusterNodes.emplace_back();
        clusterAnchors.emplace_back();
        clusterOf[start] = clusterId;

        std::vector<ogdf::node> stack{start};
        while (!stack.empty()) {
            ogdf::node v = stack.back();
            stack.pop_back();
            clusterNodes[clusterId].push_back(v);

            for (ogdf::adjEntry adj : v->adjEntries) {
                ogdf::node w = adj->twinNode();
                if (targetXByNode.count(w)) {
                    clusterAnchors[clusterId].insert(w);
                    continue;
                }
                if (clusterOf.count(w))
                    continue;
                clusterOf[w] = clusterId;
                stack.push_back(w);
            }
        }
    }

    for (size_t c = 0; c < clusterNodes.size(); ++c) {
        const std::vector<ogdf::node>& members = clusterNodes[c];
        const std::set<ogdf::node>& anchors = clusterAnchors[c];

        Graph branchGraph;
        GraphAttributes branchGA(
            branchGraph, GraphAttributes::nodeGraphics | GraphAttributes::edgeGraphics);
        EdgeArray<double> branchEdgeLengths(branchGraph);

        std::unordered_map<ogdf::node, ogdf::node> toBranchNode;
        for (ogdf::node orig : members) {
            ogdf::node bn = branchGraph.newNode();
            toBranchNode[orig] = bn;
            branchGA.width(bn) = GA.width(orig);
            branchGA.height(bn) = GA.height(orig);
        }
        for (ogdf::node anchorOrig : anchors) {
            ogdf::node bn = branchGraph.newNode();
            toBranchNode[anchorOrig] = bn;
            branchGA.width(bn) = GA.width(anchorOrig);
            branchGA.height(bn) = GA.height(anchorOrig);
        }

        std::set<std::pair<ogdf::node, ogdf::node>> addedEdges;
        for (ogdf::node orig : members) {
            for (ogdf::adjEntry adj : orig->adjEntries) {
                auto it = toBranchNode.find(adj->twinNode());
                if (it == toBranchNode.end())
                    continue;
                ogdf::node a = toBranchNode[orig];
                ogdf::node b = it->second;
                auto key = a->index() < b->index() ? std::make_pair(a, b)
                                                    : std::make_pair(b, a);
                if (!addedEdges.insert(key).second)
                    continue; // undirected adjacency visits each edge twice
                ogdf::edge e = branchGraph.newEdge(key.first, key.second);
                branchEdgeLengths[e] = edgeLengths(adj->theEdge());
            }
        }

        // FMMM lays out the branch (anchor included) with its own organic
        // random initial placement, which gives the branch a good *shape*
        // but at a location unrelated to the anchor's real, fixed position.
        // Rigidly translating the whole branch (preserving the shape FMMM
        // just found) so the anchor lands on its real target fixes that
        // cheaply. Re-running FMMM again afterward to relax further does NOT
        // help here - on a small, already-converged branch graph a fresh
        // FMMM pass tends to destabilize it rather than refine it - so
        // instead each round is an independent attempt (fresh organic layout
        // + translation), and whichever attempt leaves its anchor(s) closest
        // to their real target is kept. With a single anchor the translation
        // is always exact, so this can only matter - and never hurts - when
        // a branch reconnects to the path at more than one point.
        std::unordered_map<ogdf::node, std::pair<double, double>> bestPositions;
        double bestTension = std::numeric_limits<double>::infinity();

        for (int attempt = 0; attempt < relaxRounds; ++attempt) {
            FMMGraphLayout initialLayout(graphLayoutQuality, /*useLinearLayout=*/false,
                                        componentSeparation, aspectRatio);
            initialLayout.run(branchGA, branchEdgeLengths);

            double sumOffsetX = 0.0, sumOffsetY = 0.0;
            for (ogdf::node anchorOrig : anchors) {
                ogdf::node bn = toBranchNode[anchorOrig];
                sumOffsetX += targetXByNode[anchorOrig] - branchGA.x(bn);
                sumOffsetY += 0.0 - branchGA.y(bn);
            }
            double n = static_cast<double>(anchors.size());
            double offsetX = sumOffsetX / n;
            double offsetY = sumOffsetY / n;
            for (ogdf::node orig : members) {
                ogdf::node bn = toBranchNode[orig];
                branchGA.x(bn) += offsetX;
                branchGA.y(bn) += offsetY;
            }
            for (ogdf::node anchorOrig : anchors) {
                ogdf::node bn = toBranchNode[anchorOrig];
                branchGA.x(bn) += offsetX;
                branchGA.y(bn) += offsetY;
            }

            double tension = 0.0;
            for (ogdf::node anchorOrig : anchors) {
                ogdf::node bn = toBranchNode[anchorOrig];
                double dx = branchGA.x(bn) - targetXByNode[anchorOrig];
                double dy = branchGA.y(bn);
                tension += dx * dx + dy * dy;
            }

            if (tension < bestTension) {
                bestTension = tension;
                bestPositions.clear();
                for (ogdf::node v : branchGraph.nodes)
                    bestPositions[v] = {branchGA.x(v), branchGA.y(v)};
            }
        }

        for (const auto& entry : bestPositions) {
            branchGA.x(entry.first) = entry.second.first;
            branchGA.y(entry.first) = entry.second.second;
        }
        for (ogdf::node anchorOrig : anchors) {
            ogdf::node bn = toBranchNode[anchorOrig];
            branchGA.x(bn) = targetXByNode[anchorOrig];
            branchGA.y(bn) = 0.0;
        }

        for (ogdf::node orig : members) {
            ogdf::node bn = toBranchNode[orig];
            GA.x(orig) = branchGA.x(bn);
            GA.y(orig) = branchGA.y(bn);
        }
    }
}

// Rectangle calculation and packing helpers
static fmmm::Rectangle calculateBoundingRectangle(const GraphAttributes& GA,
                                                  const List<ogdf::node>& nodesInCC,
                                                  double componentSeparation,
                                                  int componentIndex) {
    ogdf::node first = nodesInCC.front();
    fmmm::Rectangle r;

    double max_boundary = std::max(GA.width(first) / 2, GA.height(first) / 2);
    double x_min = GA.x(first) - max_boundary;
    double x_max = GA.x(first) + max_boundary;
    double y_min = GA.y(first) - max_boundary;
    double y_max = GA.y(first) + max_boundary;

    for (ogdf::node v : nodesInCC) {
        max_boundary = std::max(GA.width(v) / 2, GA.height(v) / 2);
        double act_x_min = GA.x(v) - max_boundary;
        double act_x_max = GA.x(v) + max_boundary;
        double act_y_min = GA.y(v) - max_boundary;
        double act_y_max = GA.y(v) + max_boundary;

        if (act_x_min < x_min) x_min = act_x_min;
        if (act_x_max > x_max) x_max = act_x_max;
        if (act_y_min < y_min) y_min = act_y_min;
        if (act_y_max > y_max) y_max = act_y_max;
    }

    x_min -= componentSeparation / 2;
    x_max += componentSeparation / 2;
    y_min -= componentSeparation / 2;
    y_max += componentSeparation / 2;

    r.set_rectangle(x_max - x_min, y_max - y_min, x_min, y_min, componentIndex);
    return r;
}

static double calculateArea(double width, double height, int comp_nr, double aspectRatio) {
    double scaling = 1.0;
    if (comp_nr == 1) {
        double ratio = width / height;
        if (ratio < aspectRatio) {
            scaling = aspectRatio / ratio;
        } else {
            scaling = ratio / aspectRatio;
        }
    }
    return width * height * scaling;
}

static List<fmmm::Rectangle> rotateComponentsAndCalculateBoundingRectangles(
        GraphAttributes& GA,
        const Array<List<ogdf::node>>& nodesInCC,
        double componentSeparation,
        double aspectRatio,
        int fixedOrientationComponent,
        int stepsForRotatingComponents = 50) {
    int numCCs = nodesInCC.size();
    const Graph& G = GA.constGraph();
    List<fmmm::Rectangle> R;

    for (int i = 0; i < numCCs; i++) {
        fmmm::Rectangle r_best;
        NodeArray<DPoint> best_coords(G), old_coords(G);

        r_best = calculateBoundingRectangle(GA, nodesInCC[i], componentSeparation, i);
        double best_area = calculateArea(r_best.get_width(), r_best.get_height(),
                                        numCCs, aspectRatio);

        for (ogdf::node v : nodesInCC[i])
            old_coords[v] = best_coords[v] = GA.point(v);

        // The reference component must remain horizontal after linearization.
        int rotationSteps =
            i == fixedOrientationComponent ? 0 : stepsForRotatingComponents;
        for (int j = 1; j <= rotationSteps; j++) {
            double angle = Math::pi_2 * (double(j) / double(stepsForRotatingComponents + 1));
            double sin_j = sin(angle);
            double cos_j = cos(angle);

            for (ogdf::node v : nodesInCC[i]) {
                DPoint new_pos;
                new_pos.m_x = cos_j * old_coords[v].m_x - sin_j * old_coords[v].m_y;
                new_pos.m_y = sin_j * old_coords[v].m_x + cos_j * old_coords[v].m_y;
                GA.x(v) = new_pos.m_x;
                GA.y(v) = new_pos.m_y;
            }

            fmmm::Rectangle r_act = calculateBoundingRectangle(GA, nodesInCC[i],
                                                               componentSeparation, i);
            double act_area = calculateArea(r_act.get_width(), r_act.get_height(),
                                           numCCs, aspectRatio);

            double act_area_PI_half_rotated;
            if (numCCs == 1)
                act_area_PI_half_rotated = calculateArea(r_act.get_height(),
                                                        r_act.get_width(),
                                                        numCCs, aspectRatio);

            if (act_area < best_area) {
                r_best = r_act;
                best_area = act_area;
                for (ogdf::node v : nodesInCC[i])
                    best_coords[v] = GA.point(v);
            } else if ((numCCs == 1) && (act_area_PI_half_rotated < best_area)) {
                r_best = r_act;
                best_area = act_area_PI_half_rotated;
                for (ogdf::node v : nodesInCC[i])
                    best_coords[v] = GA.point(v);
            }
        }

        // Tip rectangle if needed
        double ratio = r_best.get_width() / r_best.get_height();
        if (i != fixedOrientationComponent &&
            ((aspectRatio < 1 && ratio > 1) ||
             (aspectRatio >= 1 && ratio < 1))) {
            for (ogdf::node v : nodesInCC[i]) {
                DPoint new_pos;
                new_pos.m_x = best_coords[v].m_y * (-1);
                new_pos.m_y = best_coords[v].m_x;
                best_coords[v] = new_pos;
            }

            DPoint new_dlc;
            new_dlc.m_x = r_best.get_old_dlc_position().m_y * (-1) - r_best.get_height();
            new_dlc.m_y = r_best.get_old_dlc_position().m_x;

            double new_width = r_best.get_height();
            double new_height = r_best.get_width();
            r_best.set_width(new_width);
            r_best.set_height(new_height);
            r_best.set_old_dlc_position(new_dlc);
        }

        for (ogdf::node v : nodesInCC[i]) {
            GA.x(v) = best_coords[v].m_x;
            GA.y(v) = best_coords[v].m_y;
        }

        R.pushBack(r_best);
    }

    return R;
}

static void reassembleDrawings(GraphAttributes& GA,
                              double componentSeparation,
                              double aspectRatio,
                              const Array<List<ogdf::node>>& nodesInCC,
                              int fixedOrientationComponent) {
    auto R = rotateComponentsAndCalculateBoundingRectangles(GA, nodesInCC,
        componentSeparation, aspectRatio, fixedOrientationComponent);

    double aspect_ratio_area, bounding_rectangles_area;
    fmmm::MAARPacking().pack_rectangles_using_Best_Fit_strategy(
        R, aspectRatio,
        ogdf::FMMMOptions::PreSort::DecreasingHeight,
        fixedOrientationComponent >= 0
            ? ogdf::FMMMOptions::TipOver::None
            : ogdf::FMMMOptions::TipOver::NoGrowingRow,
        aspect_ratio_area, bounding_rectangles_area);

    for (const auto& r : R) {
        int i = r.get_component_index();
        if (r.is_tipped_over()) {
            for (auto v : nodesInCC[i]) {
                DPoint tipped_pos(-GA.y(v), GA.x(v));
                GA.x(v) = tipped_pos.m_x;
                GA.y(v) = tipped_pos.m_y;
            }
        }

        for (auto v : nodesInCC[i]) {
            DPoint newpos = GA.point(v);
            newpos += r.get_new_dlc_position();
            newpos -= r.get_old_dlc_position();
            GA.x(v) = newpos.m_x;
            GA.y(v) = newpos.m_y;
        }
    }
}

namespace layout {

GraphLayout layoutGraph(const AssemblyGraph& graph,
                       int graphLayoutQuality,
                       bool useLinearLayout,
                       const std::vector<std::string>& referencePathNodeIds,
                       double componentSeparation,
                       double aspectRatio,
                       const LayoutSettings* settings,
                       int referencePathRelaxRounds) {
    Graph G;
    EdgeArray<double> edgeLengths(G);
    GraphAttributes GA(G,
                      GraphAttributes::nodeGraphics | GraphAttributes::edgeGraphics);
    OGDFGraphLayout ogdfLayout;

    bool referencePathRequested = useLinearLayout && !referencePathNodeIds.empty();
    buildGraph(G, GA, edgeLengths, ogdfLayout, graph, settings, useLinearLayout,
              referencePathRequested);

    std::vector<ReferencePathPoint> pathPoints;
    bool useReferencePath =
        referencePathRequested &&
        collectReferencePathPoints(graph, referencePathNodeIds, ogdfLayout,
                                   settings, pathPoints);

    // Split into connected components
    NodeArray<int> componentNumber(G);
    int numberOfComponents = connectedComponents(G, componentNumber);

    if (numberOfComponents == 0)
        return GraphLayout(graph);

    int referenceComponent = -1;
    if (useReferencePath) {
        referenceComponent = componentNumber[pathPoints.front().node];
        for (const auto& point : pathPoints) {
            if (componentNumber[point.node] != referenceComponent) {
                useReferencePath = false;
                referenceComponent = -1;
                break;
            }
        }
    }

    Array<List<ogdf::node>> nodesInCC(numberOfComponents);
    for (auto v : G.nodes)
        nodesInCC[componentNumber[v]].pushBack(v);

    // Layout each component
    for (int i = 0; i < numberOfComponents; i++) {
        if (useReferencePath && i == referenceComponent) {
            runReferencePathRelax(GA, edgeLengths, nodesInCC[i], pathPoints,
                                  graphLayoutQuality, componentSeparation,
                                  aspectRatio, referencePathRelaxRounds);
            continue;
        }

        GraphCopy GC;
        EdgeArray<double> cedgeLengths(GC);
        EdgeArray<ogdf::edge> auxCopy(G);

        GC.createEmpty(G);
        GC.initByNodes(nodesInCC[i], auxCopy);
        GraphAttributes cGA(GC, GA.attributes());

        for (ogdf::node v : GC.nodes) {
            cGA.x(v) = GA.x(GC.original(v));
            cGA.y(v) = GA.y(GC.original(v));
            cGA.width(v) = GA.width(GC.original(v));
            cGA.height(v) = GA.height(GC.original(v));
        }

        for (ogdf::edge e : GC.edges)
            cedgeLengths(e) = edgeLengths(GC.original(e));

        // A reference path (if any) supersedes the plain ID-order linear mode
        // for every other component too, since "keep everything in one line"
        // and "straighten just this path" are mutually exclusive.
        bool linearForThisComponent = useLinearLayout && !referencePathRequested;
        FMMGraphLayout layouter(graphLayoutQuality, linearForThisComponent,
                               componentSeparation, aspectRatio);
        layouter.run(cGA, cedgeLengths);

        for (ogdf::node v : GC.nodes) {
            ogdf::node w = GC.original(v);
            if (w != nullptr) {
                GA.x(w) = cGA.x(v);
                GA.y(w) = cGA.y(v);
            }
        }
    }

    reassembleDrawings(GA, componentSeparation, aspectRatio, nodesInCC,
                       referenceComponent);

    // Convert to GraphLayout
    GraphLayout result(graph);
    for (const auto& entry : ogdfLayout) {
        for (ogdf::node node : entry.second) {
            result.add(entry.first, Point(GA.x(node), GA.y(node)));
        }
    }

    // Add reverse complement nodes in double mode
    for (const auto& entry : ogdfLayout) {
        auto* rcNode = entry.first->getReverseComplement();
        if (!rcNode || !rcNode->isDrawn())
            continue;

        auto& segments = entry.second;
        for (auto it = segments.rbegin(); it != segments.rend(); ++it) {
            result.add(rcNode, Point(GA.x(*it), GA.y(*it)));
        }
    }

    return result;
}

void apply(AssemblyGraph& graph, const GraphLayout& layout) {
    graph.resetNodes();
    for (const auto& entry : layout)
        entry.first->setAsDrawn();

    for (auto* edge : graph.edges)
        edge->drawn = (edge->getStartingNode()->isDrawn() &&
                      edge->getEndingNode()->isDrawn());
}

} // namespace layout
