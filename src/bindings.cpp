// Emscripten bindings for Bandage Layout

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "../include/graphlayout.h"
#include "../include/settings.h"
#include <sstream>
#include <unordered_map>
#include <unordered_set>

using namespace emscripten;

static std::string stripOrientation(const std::string& nodeId) {
    if (!nodeId.empty() && (nodeId.back() == '+' || nodeId.back() == '-'))
        return nodeId.substr(0, nodeId.length() - 1);
    return nodeId;
}

static std::vector<std::string> getReferencePathNodeIds(
        const val& jsGraph, const std::string& referencePathName,
        std::string& validationError) {
    std::vector<std::string> nodeIds;
    if (referencePathName.empty())
        return nodeIds;

    if (!jsGraph.hasOwnProperty("paths")) {
        validationError = "The selected reference path is not present in this graph.";
        return nodeIds;
    }

    val jsPaths = jsGraph["paths"];
    if (jsPaths.isNull() || jsPaths.isUndefined()) {
        validationError = "The selected reference path is not present in this graph.";
        return nodeIds;
    }

    unsigned pathCount = jsPaths["length"].as<unsigned>();
    for (unsigned i = 0; i < pathCount; ++i) {
        val jsPath = jsPaths[i];
        if (jsPath["name"].as<std::string>() != referencePathName)
            continue;

        val jsNodeIds = jsPath["nodeIds"];
        unsigned nodeCount = jsNodeIds["length"].as<unsigned>();
        std::unordered_set<std::string> visitedSegments;

        for (unsigned j = 0; j < nodeCount; ++j) {
            std::string nodeId = jsNodeIds[j].as<std::string>();
            std::string segmentId = stripOrientation(nodeId);
            if (!visitedSegments.insert(segmentId).second) {
                validationError =
                    "Reference path '" + referencePathName +
                    "' repeats segment '" + segmentId + "' and cannot be linearized.";
                return {};
            }
            nodeIds.push_back(nodeId);
        }

        return nodeIds;
    }

    validationError =
        "The selected reference path '" + referencePathName +
        "' is not present in this graph.";
    return {};
}

static bool validateReferencePathConnectivity(
        const AssemblyGraph& graph,
        const std::vector<std::string>& referencePathNodeIds,
        const std::string& referencePathName,
        std::string& validationError) {
    if (referencePathNodeIds.empty())
        return true;

    std::unordered_map<std::string, std::vector<std::string>> adjacency;
    for (const auto* edge : graph.edges) {
        std::string from =
            stripOrientation(edge->getStartingNode()->getName());
        std::string to =
            stripOrientation(edge->getEndingNode()->getName());
        adjacency[from].push_back(to);
        adjacency[to].push_back(from);
    }

    std::vector<std::string> pending = {
        stripOrientation(referencePathNodeIds.front())
    };
    std::unordered_set<std::string> visited;
    while (!pending.empty()) {
        std::string current = pending.back();
        pending.pop_back();
        if (!visited.insert(current).second)
            continue;
        for (const auto& neighbour : adjacency[current])
            pending.push_back(neighbour);
    }

    for (const auto& nodeId : referencePathNodeIds) {
        if (visited.find(stripOrientation(nodeId)) == visited.end()) {
            validationError =
                "Reference path '" + referencePathName +
                "' is disconnected in the rendered graph at segment '" +
                nodeId + "'.";
            return false;
        }
    }
    return true;
}

// Helper to create graph from JavaScript object
AssemblyGraph* createGraphFromJS(const val& jsGraph) {
    auto* graph = new AssemblyGraph();

    // Parse nodes
    val jsNodes = jsGraph["nodes"];
    unsigned length = jsNodes["length"].as<unsigned>();

    for (unsigned i = 0; i < length; ++i) {
        val node = jsNodes[i];
        std::string id = node["id"].as<std::string>();
        unsigned nodeLength = node["length"].as<unsigned>();
        float depth = node["depth"].as<float>();

        auto* n = graph->addNode(id, nodeLength, depth);
        n->setAsDrawn(); // Assume all input nodes should be drawn
    }

    // Set up reverse complements (assuming +/- naming convention)
    for (auto& pair : graph->nodes) {
        std::string name = pair.first;
        if (name.empty()) continue;

        char sign = name.back();
        std::string baseName = name.substr(0, name.length() - 1);

        if (sign == '+') {
            std::string rcName = baseName + "-";
            auto it = graph->nodes.find(rcName);
            if (it != graph->nodes.end()) {
                pair.second->setReverseComplement(it->second);
                it->second->setReverseComplement(pair.second);
            }
        }
    }

    // Parse edges
    val jsEdges = jsGraph["edges"];
    length = jsEdges["length"].as<unsigned>();

    for (unsigned i = 0; i < length; ++i) {
        val edge = jsEdges[i];
        std::string from = edge["from"].as<std::string>();
        std::string to = edge["to"].as<std::string>();
        int overlap = edge.hasOwnProperty("overlap") ?
                     edge["overlap"].as<int>() : 0;

        auto* e = graph->addEdge(from, to, overlap, UNKNOWN_OVERLAP);
        if (e) e->setAsDrawn();
    }

    return graph;
}

// Helper to convert layout to JavaScript object
val layoutToJS(const GraphLayout& layout) {
    val result = val::object();
    val nodePositions = val::object();

    for (const auto& entry : layout) {
        std::string nodeName = entry.first->getName();
        const auto& segments = entry.second;

        val jsSegments = val::array();
        for (size_t i = 0; i < segments.size(); ++i) {
            val point = val::object();
            point.set("x", segments[i].x);
            point.set("y", segments[i].y);
            jsSegments.set(i, point);
        }

        nodePositions.set(nodeName, jsSegments);
    }

    result.set("nodePositions", nodePositions);
    return result;
}

// Main layout computation function exposed to JavaScript
val computeLayout(val jsGraph, val jsOptions) {
    // Parse options
    int quality = jsOptions.hasOwnProperty("quality") ?
                 jsOptions["quality"].as<int>() : 1;
    bool linearLayout = jsOptions.hasOwnProperty("linearLayout") ?
                       jsOptions["linearLayout"].as<bool>() : false;
    std::string referencePathName =
        jsOptions.hasOwnProperty("referencePathName") ?
        jsOptions["referencePathName"].as<std::string>() : "";
    double componentSeparation = jsOptions.hasOwnProperty("componentSeparation") ?
                                jsOptions["componentSeparation"].as<double>() : 15.0;
    double aspectRatio = jsOptions.hasOwnProperty("aspectRatio") ?
                        jsOptions["aspectRatio"].as<double>() : 1.333333;

    // Create settings
    LayoutSettings settings;
    settings.graphLayoutQuality = quality;
    settings.useLinearLayout = linearLayout;
    settings.componentSeparation = componentSeparation;
    settings.aspectRatio = aspectRatio;

    if (jsOptions.hasOwnProperty("nodeLengthPerMegabase")) {
        settings.autoNodeLengthPerMegabase = jsOptions["nodeLengthPerMegabase"].as<double>();
        settings.manualNodeLengthPerMegabase = jsOptions["nodeLengthPerMegabase"].as<double>();
    }
    if (jsOptions.hasOwnProperty("minimumNodeLength")) {
        settings.minimumNodeLength = jsOptions["minimumNodeLength"].as<double>();
    }
    if (jsOptions.hasOwnProperty("nodeSegmentLength")) {
        settings.nodeSegmentLength = jsOptions["nodeSegmentLength"].as<double>();
    }
    if (jsOptions.hasOwnProperty("edgeLength")) {
        settings.edgeLength = jsOptions["edgeLength"].as<double>();
    }

    // Create graph from JavaScript input
    AssemblyGraph* graph = createGraphFromJS(jsGraph);
    std::string referencePathError;
    std::vector<std::string> referencePathNodeIds;
    if (linearLayout) {
        referencePathNodeIds =
            getReferencePathNodeIds(jsGraph, referencePathName,
                                    referencePathError);
    }

    if (!referencePathError.empty()) {
        val errorResult = val::object();
        errorResult.set("error", referencePathError);
        delete graph;
        return errorResult;
    }

    for (const auto& nodeId : referencePathNodeIds) {
        if (graph->nodes.find(nodeId) == graph->nodes.end()) {
            val errorResult = val::object();
            errorResult.set(
                "error",
                "Reference path '" + referencePathName +
                "' contains segment '" + nodeId +
                "', which is not present in the rendered graph.");
            delete graph;
            return errorResult;
        }
    }
    if (!validateReferencePathConnectivity(
            *graph, referencePathNodeIds, referencePathName,
            referencePathError)) {
        val errorResult = val::object();
        errorResult.set("error", referencePathError);
        delete graph;
        return errorResult;
    }

    // Compute layout
    GraphLayout layoutResult = layout::layoutGraph(*graph, quality, linearLayout,
                                                   referencePathNodeIds,
                                                   componentSeparation, aspectRatio,
                                                   &settings);

    // Convert to JavaScript object
    val result = layoutToJS(layoutResult);

    // Clean up
    delete graph;

    return result;
}

EMSCRIPTEN_BINDINGS(bandage_layout) {
    function("computeLayout", &computeLayout);
}
