// Shared frontend data model used across parsing, worker messaging, layout
// results, and the React UI.

export interface GraphNode {
  id: string
  name: string
  length: number
  depth: number
  // Sequence is optional because mock/example graphs only model summary fields,
  // while imported GFA segments can provide the full nucleotide string.
  sequence?: string
}

export interface GraphEdge {
  from: string
  to: string
  overlap: number
  pathIds?: string[] // Optional: which paths use this edge
}

export interface GraphPath {
  name: string
  nodeIds: string[] // Ordered list of node IDs in the path
  color?: string // Optional color for this path
}

export interface Graph {
  name: string
  description: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  // Paths can come from GFA P-lines or W-lines and are optional because not
  // every graph carries embedded traversal information.
  paths?: GraphPath[] // Optional paths/walks embedded in the source GFA
}

export interface IndexedGraph {
  id: string
  name: string
  description: string
}

export interface IndexedAnnotation {
  id: string
  name: string
  description: string
}

export interface RegionPath {
  source: string
  reference: string
  haplotype: string
  sequence: string
  start: number
  end: number
  entries: number
  label: string
}

export interface BedAnnotation {
  id: string
  chromosome: string
  start: number
  end: number
  lineNumber: number
  columns: BedAnnotationColumn[]
}

export interface BedAnnotationColumn {
  index: number
  header: string
  value: string
}

export interface LayoutOptions {
  quality: number
  linearLayout: boolean
  componentSeparation: number
  aspectRatio: number
  nodeLengthPerMegabase: number
  minimumNodeLength: number
  nodeSegmentLength: number
  edgeLength: number
}

export interface NodeSegment {
  x: number
  y: number
}

export interface LayoutResult {
  nodePositions: Record<string, NodeSegment[]>
}

export interface LayoutComputation {
  result: LayoutResult
  duration: number
}

export interface GraphStats {
  nodeCount: number
  edgeCount: number
  totalLength: number
  minLength: number
  maxLength: number
  avgLength: number
  medianLength: number
  lengthRatio: string
  avgDepth: number
  minDepth: number
  maxDepth: number
  uniqueNodes: GraphNode[]
}

export interface Transform {
  scale: number
  translateX: number
  translateY: number
}

export interface ContextMenu {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
}

export interface DetailsDialog {
  visible: boolean
  nodeId: string | null
}

export type ColorScheme = 'uniform' | 'random' | 'depth' | 'grey'
