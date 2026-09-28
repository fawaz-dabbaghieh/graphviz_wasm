import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
  NodeSegment,
} from '../types'

export interface DisplayNode {
  key: string
  representativeId: string
  node: GraphNode
  nodeIds: string[]
  segments: NodeSegment[]
}

// Each traversal only ever needs two things: which path it belongs to, and
// whether it runs the same direction as the edge's representativeEdge or its
// reverse-complement (a path can traverse either side of a stored L-line -
// see resolveTraversalEdge). Packing both into one signed integer - the path
// index for a forward traversal, -(index + 1) for a reverse-complement one -
// avoids a per-traversal object allocation entirely. On a real ~54k-node,
// 470-haplotype pangenome graph this array held ~15 million entries; the
// previous {edge, pathId} object-per-entry representation measured at ~600MB
// for that alone, versus a few dozen MB as plain Int32Arrays here.
export type EncodedTraversal = number

export function decodeTraversalPathIndex(encoded: EncodedTraversal): number {
  return encoded >= 0 ? encoded : -encoded - 1
}

export function decodeTraversalIsForward(encoded: EncodedTraversal): boolean {
  return encoded >= 0
}

function encodeTraversal(pathIndex: number, isForward: boolean): EncodedTraversal {
  return isForward ? pathIndex : -pathIndex - 1
}

// Reconstructs the {from, to} a traversal actually runs, without needing to
// have stored a whole edge object for it. A forward traversal is exactly
// representativeEdge; a reverse-complement one swaps and flips both ends.
// overlap is never read off a per-traversal edge anywhere in the app (only
// off the canonical GraphEdge), so reusing representativeEdge's value for
// both directions is safe.
export function resolveTraversalEdge(
  encoded: EncodedTraversal,
  representativeEdge: GraphEdge,
): GraphEdge {
  if (decodeTraversalIsForward(encoded)) return representativeEdge
  return {
    from: getReverseComplementNodeId(representativeEdge.to),
    to: getReverseComplementNodeId(representativeEdge.from),
    overlap: representativeEdge.overlap,
  }
}

export function resolveTraversalPathName(
  encoded: EncodedTraversal,
  paths: GraphPath[],
): string {
  return paths[decodeTraversalPathIndex(encoded)]!.name
}

export interface DisplayEdge {
  key: string
  representativeEdge: GraphEdge
  edges: GraphEdge[]
  fromNodeKey: string
  toNodeKey: string
  pathIds: string[]
  pathTraversals: Int32Array
}

export interface DisplayGraph {
  nodes: DisplayNode[]
  nodesByKey: Map<string, DisplayNode>
  edges: DisplayEdge[]
}

function getCanonicalEdgeKeyForPair(fromNodeId: string, toNodeId: string): string {
  const forwardKey = `${fromNodeId}->${toNodeId}`
  const reverseComplementKey = `${getReverseComplementNodeId(toNodeId)}->${getReverseComplementNodeId(fromNodeId)}`
  return forwardKey < reverseComplementKey ? forwardKey : reverseComplementKey
}

export function stripNodeOrientation(nodeId: string): string {
  return nodeId.endsWith('+') || nodeId.endsWith('-')
    ? nodeId.slice(0, -1)
    : nodeId
}

export function pathHasRepeatedSegments(nodeIds: string[]): boolean {
  const visitedSegments = new Set<string>()
  return nodeIds.some(nodeId => {
    const segmentId = stripNodeOrientation(nodeId)
    if (visitedSegments.has(segmentId)) return true
    visitedSegments.add(segmentId)
    return false
  })
}

export function getReverseComplementNodeId(nodeId: string): string {
  if (nodeId.endsWith('+')) return `${nodeId.slice(0, -1)}-`
  if (nodeId.endsWith('-')) return `${nodeId.slice(0, -1)}+`
  return nodeId
}

export function reverseSegments(segments: NodeSegment[]): NodeSegment[] {
  // Reverse-complement nodes reuse the same visible contig geometry, but the
  // segment traversal order must flip so edge attachment points stay correct.
  return [...segments].reverse().map(segment => ({ ...segment }))
}

function chooseRepresentativeNodeId(nodeIds: string[]): string {
  // Single-mode Bandage prefers positive nodes when they exist, but still
  // falls back to the only available orientation for one-sided graphs.
  return (
    nodeIds.find(nodeId => nodeId.endsWith('+')) ??
    [...nodeIds].sort()[0] ??
    nodeIds[0]!
  )
}

function getCanonicalEdgeKey(edge: GraphEdge): string {
  return getCanonicalEdgeKeyForPair(edge.from, edge.to)
}

function chooseRepresentativeEdge(
  edges: GraphEdge[],
  nodesByKey: Map<string, DisplayNode>,
): GraphEdge {
  return (
    edges.find(edge => {
      const fromNode = nodesByKey.get(stripNodeOrientation(edge.from))
      const toNode = nodesByKey.get(stripNodeOrientation(edge.to))

      return (
        edge.from === fromNode?.representativeId &&
        edge.to === toNode?.representativeId
      )
    }) ??
    edges[0]!
  )
}

// Deliberately takes only the graph, not node positions: grouping nodes and
// walking every path to build pathTraversals (the expensive part - tens of
// millions of entries on a large multi-haplotype pangenome graph) depends
// only on topology, never on where anything is drawn. Segments start empty
// and are always filled in afterward by updateDisplayGraphNodePositions, so
// coupling this to a specific layout result would only force the whole
// traversal walk to redo itself on every redraw for no benefit - which is
// exactly what used to happen when nodePositions was a dependency here.
export function buildDisplayGraph(graph: Graph): DisplayGraph {
  const nodeGroups = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) {
    const key = stripNodeOrientation(node.id)
    if (!nodeGroups.has(key)) {
      nodeGroups.set(key, [])
    }
    nodeGroups.get(key)!.push(node)
  }

  const nodes = Array.from(nodeGroups.entries(), ([key, groupedNodes]) => {
    const representativeId = chooseRepresentativeNodeId(
      groupedNodes.map(node => node.id),
    )
    const representativeNode =
      groupedNodes.find(node => node.id === representativeId) ?? groupedNodes[0]!

    return {
      key,
      representativeId,
      node: representativeNode,
      nodeIds: groupedNodes.map(node => node.id),
      segments: [] as NodeSegment[],
    }
  })

  const nodesByKey = new Map(nodes.map(node => [node.key, node]))

  const edgeGroups = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    const key = getCanonicalEdgeKey(edge)
    if (!edgeGroups.has(key)) {
      edgeGroups.set(key, [])
    }
    edgeGroups.get(key)!.push(edge)
  }

  // representativeEdge has to be chosen before traversals can be encoded
  // relative to it (forward vs. reverse-complement), so this builds the edge
  // shells first and fills in pathTraversals/pathIds in a second pass below.
  const edgeShells = new Map<
    string,
    {
      representativeEdge: GraphEdge
      groupedEdges: GraphEdge[]
      traversals: number[]
    }
  >()
  for (const [key, groupedEdges] of edgeGroups) {
    edgeShells.set(key, {
      representativeEdge: chooseRepresentativeEdge(groupedEdges, nodesByKey),
      groupedEdges,
      traversals: [],
    })
  }

  const paths = graph.paths ?? []
  const pathIndexByName = new Map(paths.map((path, index) => [path.name, index]))

  for (const path of paths) {
    const pathIndex = pathIndexByName.get(path.name)!
    for (let i = 0; i < path.nodeIds.length - 1; i++) {
      const from = path.nodeIds[i]!
      const to = path.nodeIds[i + 1]!
      const edgeKey = getCanonicalEdgeKeyForPair(from, to)
      const shell = edgeShells.get(edgeKey)
      if (!shell) continue

      // A path can traverse either this edge's stored direction or its
      // reverse-complement (see resolveTraversalEdge) - which is which can
      // only be decided once representativeEdge exists, unlike the
      // direction-agnostic canonical key used to find it above.
      const isForward =
        from === shell.representativeEdge.from &&
        to === shell.representativeEdge.to
      shell.traversals.push(encodeTraversal(pathIndex, isForward))
    }
  }

  const edges = Array.from(edgeShells.entries(), ([key, shell]) => {
    const { representativeEdge, groupedEdges, traversals } = shell
    const pathTraversals = Int32Array.from(traversals)

    const pathIndexSet = new Set<number>()
    for (const encoded of pathTraversals) {
      pathIndexSet.add(decodeTraversalPathIndex(encoded))
    }
    const pathIds = Array.from(pathIndexSet, index => paths[index]!.name)

    return {
      key,
      representativeEdge,
      edges: groupedEdges,
      fromNodeKey: stripNodeOrientation(representativeEdge.from),
      toNodeKey: stripNodeOrientation(representativeEdge.to),
      pathIds,
      pathTraversals,
    }
  })

  return { nodes, nodesByKey, edges }
}

export function updateDisplayGraphNodePositions(
  displayGraph: DisplayGraph,
  nodePositions: Record<string, NodeSegment[]>,
): DisplayGraph {
  const nodes = displayGraph.nodes.map(displayNode => ({
    ...displayNode,
    segments: nodePositions[displayNode.representativeId] ?? [],
  }))

  return {
    nodes,
    nodesByKey: new Map(nodes.map(node => [node.key, node])),
    edges: displayGraph.edges,
  }
}

export function filterDisplayGraphByPaths(
  displayGraph: DisplayGraph,
  paths: GraphPath[],
  selectedPathIds: Set<string>,
): DisplayGraph {
  const selectedNodeKeys = new Set<string>()

  // Path node IDs include orientation, while the display graph collapses both
  // orientations into one visible node.
  for (const path of paths) {
    if (!selectedPathIds.has(path.name)) continue

    for (const nodeId of path.nodeIds) {
      selectedNodeKeys.add(stripNodeOrientation(nodeId))
    }
  }

  const nodes = displayGraph.nodes.filter(node => selectedNodeKeys.has(node.key))
  const edges = displayGraph.edges.filter(edge =>
    edge.pathTraversals.some(encoded =>
      selectedPathIds.has(resolveTraversalPathName(encoded, paths)),
    ),
  )

  return {
    nodes,
    nodesByKey: new Map(nodes.map(node => [node.key, node])),
    edges,
  }
}

export function resolveDisplaySegments(
  nodeId: string,
  displayGraph: DisplayGraph,
): NodeSegment[] | null {
  const displayNode = displayGraph.nodesByKey.get(stripNodeOrientation(nodeId))
  if (!displayNode) return null

  if (nodeId === displayNode.representativeId) {
    return displayNode.segments
  }

  return reverseSegments(displayNode.segments)
}

export function getDisplayNodes(graph: Graph): GraphNode[] {
  const nodeGroups = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) {
    const key = stripNodeOrientation(node.id)
    if (!nodeGroups.has(key)) {
      nodeGroups.set(key, [])
    }
    nodeGroups.get(key)!.push(node)
  }

  return Array.from(nodeGroups.values(), groupedNodes => {
    return (
      groupedNodes.find(node => node.id.endsWith('+')) ??
      [...groupedNodes].sort((a, b) => a.id.localeCompare(b.id))[0]!
    )
  })
}
