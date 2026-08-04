import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
} from '@floating-ui/react'
import type {
  LayoutResult,
  Graph,
  Transform,
  ContextMenu,
  DetailsDialog,
  GraphNode,
  ColorScheme,
} from '../types'
import {
  buildDisplayGraph,
  filterDisplayGraphByPaths,
  updateDisplayGraphNodePositions,
  resolveDisplaySegments,
  stripNodeOrientation,
  type DisplayEdgeTraversal,
} from '../utils/displayGraph'
import { clampZoom } from '../utils/zoom'

interface GraphCanvasProps {
  layoutResult: LayoutResult
  graph: Graph
  width?: number
  height?: number
  isDarkMode?: boolean
  colorScheme?: ColorScheme
  zoom?: number
  zoomRequestId?: number
  onInternalZoomChange?: (zoom: number) => void
  focusNodeId?: string | null
  focusNodeRequestId?: number
  contigThickness?: number
  connectorThickness?: number
  drawLabels?: boolean
  labelLengthThreshold?: number
  drawPaths?: boolean
  // The selector hands the canvas the exact set of path IDs that should remain
  // visible without changing the underlying graph model.
  visiblePathIds?: Set<string>
  filterToSelectedPaths?: boolean
  nodeColorOverrides?: Record<string, string>
  onUseAsStartNode?: (nodeId: string) => void
  debugHitboxes?: boolean // Hidden flag to visualize edge hit areas
}

const SEQUENCE_PREVIEW_CUTOFF = 100
const SEQUENCE_PREVIEW_PREFIX_LENGTH = Math.ceil(SEQUENCE_PREVIEW_CUTOFF / 2)
const SEQUENCE_PREVIEW_SUFFIX_LENGTH = Math.floor(SEQUENCE_PREVIEW_CUTOFF / 2)
// Wheel devices report very different delta sizes, so cap each rotation update
// while retaining small trackpad deltas for continuous motion.
const ROTATION_RADIANS_PER_PIXEL = 0.002
const MAX_ROTATION_STEP = Math.PI / 15
const NO_PATH_TRAVERSALS: DisplayEdgeTraversal[] = []

// Keep accumulated angles bounded so trigonometric calculations remain stable
// after long rotation sessions.
function normalizeRotation(rotation: number): number {
  return Math.atan2(Math.sin(rotation), Math.cos(rotation))
}

// Normalize line/page wheel units to approximate CSS pixels before converting
// the movement to radians.
function getWheelDeltaPixels(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * pageHeight
  }
  return event.deltaY
}

function getNodeSequence(node: GraphNode): string | null {
  if (!node.sequence || node.sequence === '*') return null

  // The single-mode display treats the contig itself as the primary entity, so
  // the details dialog shows the stored segment sequence rather than a strand-
  // specific reverse complement of whichever internal node was displayed.
  return node.sequence
}

function formatSequencePreview(sequence: string): string {
  if (sequence.length <= SEQUENCE_PREVIEW_CUTOFF) return sequence

  return `${sequence.slice(0, SEQUENCE_PREVIEW_PREFIX_LENGTH)}.........${sequence.slice(-SEQUENCE_PREVIEW_SUFFIX_LENGTH)}`
}

function GraphCanvasComponent({
  layoutResult,
  graph,
  width = 800,
  height = 600,
  isDarkMode = true,
  colorScheme = 'uniform',
  zoom,
  zoomRequestId = 0,
  onInternalZoomChange,
  focusNodeId,
  focusNodeRequestId = 0,
  contigThickness = 6,
  connectorThickness = 3,
  drawLabels = true,
  labelLengthThreshold = 0,
  drawPaths = true,
  visiblePathIds,
  filterToSelectedPaths = false,
  nodeColorOverrides,
  onUseAsStartNode,
  debugHitboxes = false,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
  })
  const transformRef = useRef<Transform>({
    scale: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
  })
  const handledZoomRequestIdRef = useRef(zoomRequestId)
  const handledFocusRequestIdRef = useRef(focusNodeRequestId)
  const zoomReportFrameRef = useRef<number | null>(null)
  const pendingZoomReportRef = useRef<number | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  // Floating UI for tooltip
  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(10), flip(), shift({ padding: 5 })],
    whileElementsMounted: autoUpdate,
  })
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [modifiedNodePositions, setModifiedNodePositions] = useState<Record<
    string,
    { x: number; y: number }[]
  > | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  })
  const [detailsDialog, setDetailsDialog] = useState<DetailsDialog>({
    visible: false,
    nodeId: null,
  })
  const activeNodePositions = useMemo(
    () => modifiedNodePositions || layoutResult.nodePositions,
    [layoutResult.nodePositions, modifiedNodePositions],
  )
  const displayGraphTopology = useMemo(
    () => buildDisplayGraph(graph, layoutResult.nodePositions),
    [graph, layoutResult.nodePositions],
  )
  const visibleDisplayGraphTopology = useMemo(() => {
    if (!filterToSelectedPaths || !visiblePathIds) {
      return displayGraphTopology
    }

    return filterDisplayGraphByPaths(
      displayGraphTopology,
      graph.paths ?? [],
      visiblePathIds,
    )
  }, [
    displayGraphTopology,
    filterToSelectedPaths,
    graph.paths,
    visiblePathIds,
  ])
  const displayGraph = useMemo(
    () =>
      updateDisplayGraphNodePositions(
        visibleDisplayGraphTopology,
        activeNodePositions,
      ),
    [activeNodePositions, visibleDisplayGraphTopology],
  )
  const boundsRef = useRef<{
    minX: number
    maxX: number
    minY: number
    maxY: number
    fitScale: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const reportInternalZoom = useCallback(
    (nextZoom: number) => {
      if (!onInternalZoomChange) return

      pendingZoomReportRef.current = nextZoom
      if (zoomReportFrameRef.current !== null) return

      zoomReportFrameRef.current = window.requestAnimationFrame(() => {
        zoomReportFrameRef.current = null
        const zoomToReport = pendingZoomReportRef.current
        pendingZoomReportRef.current = null
        if (zoomToReport !== null) {
          onInternalZoomChange(zoomToReport)
        }
      })
    },
    [onInternalZoomChange],
  )

  useEffect(
    () => () => {
      if (zoomReportFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomReportFrameRef.current)
      }
    },
    [],
  )

  // Calculate bounds once when layout changes
  useEffect(() => {
    if (!layoutResult) return

    const { nodePositions } = layoutResult
    let minX = Infinity,
      maxX = -Infinity
    let minY = Infinity,
      maxY = -Infinity

    Object.values(nodePositions).forEach(segments => {
      segments.forEach(({ x, y }) => {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      })
    })

    const graphWidth = maxX - minX
    const graphHeight = maxY - minY
    const padding = 40
    const fitScale = Math.min(
      (width - 2 * padding) / graphWidth,
      (height - 2 * padding) / graphHeight,
    )
    const offsetX = (width - graphWidth * fitScale) / 2 - minX * fitScale
    const offsetY = (height - graphHeight * fitScale) / 2 - minY * fitScale

    const nextTransform = {
      scale: fitScale,
      // A newly computed layout starts in its original OGDF orientation.
      rotation: 0,
      translateX: offsetX,
      translateY: offsetY,
    }

    boundsRef.current = { minX, maxX, minY, maxY, fitScale, offsetX, offsetY }
    transformRef.current = nextTransform
    setTransform(nextTransform)

    reportInternalZoom(fitScale)

    // Reset modified positions when layout changes
    setModifiedNodePositions(null)
  }, [layoutResult, width, height, reportInternalZoom])

  // Sync zoom prop to transform when the sidebar slider sends an explicit
  // command. Wheel zoom intentionally does not update this prop.
  useEffect(() => {
    if (zoom === undefined) return
    if (handledZoomRequestIdRef.current === zoomRequestId) return

    handledZoomRequestIdRef.current = zoomRequestId

    const prev = transformRef.current
    if (Math.abs(zoom - prev.scale) < 0.0001) return

    const scaleFactor = zoom / prev.scale
    const centerX = width / 2
    const centerY = height / 2

    const nextTransform = {
      // Slider zoom changes only scale/translation and preserves rotation.
      ...prev,
      scale: zoom,
      translateX: centerX - (centerX - prev.translateX) * scaleFactor,
      translateY: centerY - (centerY - prev.translateY) * scaleFactor,
    }

    transformRef.current = nextTransform
    setTransform(nextTransform)
  }, [zoom, zoomRequestId, width, height])

  useEffect(() => {
    if (!focusNodeId) return
    if (handledFocusRequestIdRef.current === focusNodeRequestId) return

    handledFocusRequestIdRef.current = focusNodeRequestId

    const targetNode = displayGraph.nodes.find(
      node =>
        node.representativeId === focusNodeId ||
        node.nodeIds.includes(focusNodeId) ||
        node.node.name === focusNodeId ||
        node.key === stripNodeOrientation(focusNodeId),
    )
    if (!targetNode || targetNode.segments.length === 0) return

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    targetNode.segments.forEach(segment => {
      minX = Math.min(minX, segment.x)
      maxX = Math.max(maxX, segment.x)
      minY = Math.min(minY, segment.y)
      maxY = Math.max(maxY, segment.y)
    })

    const nodeWidth = maxX - minX
    const nodeHeight = maxY - minY
    const rotation = transformRef.current.rotation
    const rotationCosine = Math.cos(rotation)
    const rotationSine = Math.sin(rotation)
    // Project the node's bounding box through the current rotation so focus
    // scaling leaves similar surrounding context at every angle.
    const rotatedNodeWidth =
      Math.abs(nodeWidth * rotationCosine) +
      Math.abs(nodeHeight * rotationSine)
    const rotatedNodeHeight =
      Math.abs(nodeWidth * rotationSine) +
      Math.abs(nodeHeight * rotationCosine)
    const focusWidth = Math.max(rotatedNodeWidth * 4, 80)
    const focusHeight = Math.max(rotatedNodeHeight * 4, 80)
    const availableWidth = Math.max(width - 160, width * 0.5)
    const availableHeight = Math.max(height - 160, height * 0.5)
    const focusScale = Math.min(
      availableWidth / focusWidth,
      availableHeight / focusHeight,
    )
    const nextScale = clampZoom(
      Math.max(boundsRef.current?.fitScale ?? 0, focusScale),
    )
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    // Rotate the graph-space node center before solving the translation that
    // places it at the center of the canvas.
    const rotatedCenterX =
      (centerX * rotationCosine - centerY * rotationSine) * nextScale
    const rotatedCenterY =
      (centerX * rotationSine + centerY * rotationCosine) * nextScale
    const nextTransform = {
      scale: nextScale,
      rotation,
      translateX: width / 2 - rotatedCenterX,
      translateY: height / 2 - rotatedCenterY,
    }

    transformRef.current = nextTransform
    setTransform(nextTransform)
    setSelectedNode(targetNode.representativeId)
    setHoveredNode(null)
    setHoveredEdge(null)
    reportInternalZoom(nextScale)
  }, [
    displayGraph.nodes,
    focusNodeId,
    focusNodeRequestId,
    height,
    reportInternalZoom,
    width,
  ])

  const pathColors = useMemo(() => {
    const colors = new Map<string, string>()
    const paths = graph.paths ?? []
    const hueStep = paths.length > 0 ? 360 / paths.length : 0

    paths.forEach((path, pathIndex) => {
      colors.set(path.name, `hsl(${pathIndex * hueStep}, 70%, 50%)`)
    })
    return colors
  }, [graph.paths])

  const getPathColor = useCallback(
    (pathName: string): string => pathColors.get(pathName) ?? '#888',
    [pathColors],
  )

  const visiblePathTraversalsByList = useMemo(() => {
    const visibleTraversals = new Map<
      DisplayEdgeTraversal[],
      DisplayEdgeTraversal[]
    >()

    for (const edge of displayGraphTopology.edges) {
      if (
        !drawPaths ||
        edge.pathTraversals.length === 0 ||
        visiblePathIds?.size === 0
      ) {
        visibleTraversals.set(edge.pathTraversals, NO_PATH_TRAVERSALS)
      } else if (!visiblePathIds) {
        visibleTraversals.set(edge.pathTraversals, edge.pathTraversals)
      } else {
        visibleTraversals.set(
          edge.pathTraversals,
          edge.pathTraversals.filter(traversal =>
            visiblePathIds.has(traversal.pathId),
          ),
        )
      }
    }

    return visibleTraversals
  }, [displayGraphTopology.edges, drawPaths, visiblePathIds])

  const getVisiblePathTraversals = useCallback(
    (pathTraversals: DisplayEdgeTraversal[]) =>
      visiblePathTraversalsByList.get(pathTraversals) ?? NO_PATH_TRAVERSALS,
    [visiblePathTraversalsByList],
  )

  useEffect(() => {
    // Filtering can invalidate array-based edge hover state and hide a
    // selected node, so discard transient interactions when its inputs change.
    setHoveredNode(null)
    setHoveredEdge(null)
    setSelectedNode(null)
    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null })
  }, [visibleDisplayGraphTopology])

  // Colors depend on graph data and user settings, not the viewport. Cache
  // them so wheel/pan redraws only perform a map lookup per visible node.
  const nodeColorsById = useMemo(() => {
    const colors = new Map<string, [number, number, number]>()
    let minDepth = Infinity
    let maxDepth = -Infinity

    if (colorScheme === 'depth') {
      graph.nodes.forEach(node => {
        if (!Number.isFinite(node.depth)) return
        minDepth = Math.min(minDepth, node.depth)
        maxDepth = Math.max(maxDepth, node.depth)
      })
    }

    const computeNodeColor = (
      node: GraphNode,
    ): [number, number, number] => {
      const overrideColor = nodeColorOverrides?.[node.id]
      if (overrideColor) {
        const normalizedColor = overrideColor.replace(/^#/, '')
        const parsedColor = Number.parseInt(normalizedColor, 16)

        if (normalizedColor.length === 6 && Number.isFinite(parsedColor)) {
          return [
            (parsedColor >> 16) & 255,
            (parsedColor >> 8) & 255,
            parsedColor & 255,
          ]
        }
      }

      switch (colorScheme) {
        case 'uniform':
          // Bandage default: rgb(178, 34, 34) - firebrick red
          return [52, 152, 219]

        case 'random': {
          // Use node ID to generate consistent random color
          let hash = 0
          for (let i = 0; i < node.id.length; i++) {
            hash = node.id.charCodeAt(i) + ((hash << 5) - hash)
          }
          const hue = Math.abs(hash % 360)
          // Convert HSL to RGB
          const s = 0.7
          const l = 0.5
          const c = (1 - Math.abs(2 * l - 1)) * s
          const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
          const m = l - c / 2
          let r = 0,
            g = 0,
            b = 0
          if (hue < 60) {
            r = c
            g = x
            b = 0
          } else if (hue < 120) {
            r = x
            g = c
            b = 0
          } else if (hue < 180) {
            r = 0
            g = c
            b = x
          } else if (hue < 240) {
            r = 0
            g = x
            b = c
          } else if (hue < 300) {
            r = x
            g = 0
            b = c
          } else {
            r = c
            g = 0
            b = x
          }
          return [
            Math.round((r + m) * 255),
            Math.round((g + m) * 255),
            Math.round((b + m) * 255),
          ]
        }

        case 'depth': {
          // Color based on depth - use viridis-like color map
          const normalizedDepth =
            Number.isFinite(node.depth) && maxDepth > minDepth
              ? (node.depth - minDepth) / (maxDepth - minDepth)
              : 0.5

          // Simple viridis-like gradient
          const t = Math.max(0, Math.min(1, normalizedDepth))
          if (t < 0.25) {
            const s = t / 0.25
            return [
              Math.round(68 + (59 - 68) * s),
              Math.round(1 + (82 - 1) * s),
              Math.round(84 + (139 - 84) * s),
            ]
          } else if (t < 0.5) {
            const s = (t - 0.25) / 0.25
            return [
              Math.round(59 + (33 - 59) * s),
              Math.round(82 + (145 - 82) * s),
              Math.round(139 + (140 - 139) * s),
            ]
          } else if (t < 0.75) {
            const s = (t - 0.5) / 0.25
            return [
              Math.round(33 + (94 - 33) * s),
              Math.round(145 + (201 - 145) * s),
              Math.round(140 + (98 - 140) * s),
            ]
          } else {
            const s = (t - 0.75) / 0.25
            return [
              Math.round(94 + (253 - 94) * s),
              Math.round(201 + (231 - 201) * s),
              Math.round(98 + (37 - 98) * s),
            ]
          }
        }

        case 'grey':
          // Medium grey color
          return [160, 160, 160]

        default:
          return [52, 152, 219]
      }
    }

    graph.nodes.forEach(node => {
      colors.set(node.id, computeNodeColor(node))
    })

    return colors
  }, [colorScheme, graph.nodes, nodeColorOverrides])

  const getNodeColor = useCallback(
    (node: GraphNode): [number, number, number] =>
      nodeColorsById.get(node.id) ?? [52, 152, 219],
    [nodeColorsById],
  )

  const getDisplayNodeSegments = useCallback(
    (nodeId: string) => resolveDisplaySegments(nodeId, displayGraph),
    [displayGraph],
  )

  const getEdgeOffset = useCallback(
    (pathIdx: number, numPaths: number, scale: number) => {
      const offsetDist = 3 / scale
      return (pathIdx - (numPaths - 1) / 2) * offsetDist
    },
    [],
  )

  const buildEdgeGeometry = useCallback(
    (edge: Graph['edges'][number], offsetX: number, offsetY: number, scale: number) => {
      const fromSegments = getDisplayNodeSegments(edge.from)
      const toSegments = getDisplayNodeSegments(edge.to)

      if (!fromSegments || !toSegments || fromSegments.length === 0 || toSegments.length === 0) {
        return null
      }

      const fromEnd = fromSegments[fromSegments.length - 1]
      const toStart = toSegments[0]
      if (!fromEnd || !toStart) return null

      const fromBase = stripNodeOrientation(edge.from)
      const toBase = stripNodeOrientation(edge.to)
      const isSelfLoop = edge.from === edge.to
      const isReverseComplementLoop = fromBase === toBase && edge.from !== edge.to

      let segmentDirX = 1
      let segmentDirY = 0
      if (fromSegments.length >= 2) {
        const prevSeg = fromSegments[fromSegments.length - 2]!
        const dx = fromEnd.x - prevSeg.x
        const dy = fromEnd.y - prevSeg.y
        const len = Math.hypot(dx, dy)
        if (len > 0) {
          segmentDirX = dx / len
          segmentDirY = dy / len
        }
      }

      if (isSelfLoop) {
        const extensionLength = 50 / scale
        const cp1x = fromEnd.x + offsetX + segmentDirX * extensionLength
        const cp1y = fromEnd.y + offsetY + segmentDirY * extensionLength
        const cp2x = toStart.x + offsetX - segmentDirX * extensionLength
        const cp2y = toStart.y + offsetY - segmentDirY * extensionLength

        const perpX = -segmentDirY
        const perpY = segmentDirX
        const perpShift = extensionLength

        const nodeMidX = (fromEnd.x + toStart.x) / 2 + offsetX
        const nodeMidY = (fromEnd.y + toStart.y) / 2 + offsetY

        return {
          kind: 'self-loop' as const,
          start: { x: fromEnd.x + offsetX, y: fromEnd.y + offsetY },
          end: { x: toStart.x + offsetX, y: toStart.y + offsetY },
          controlPoint1: { x: cp1x, y: cp1y },
          controlPoint2: { x: cp2x, y: cp2y },
          cp1Shifted: {
            x: cp1x + perpX * perpShift,
            y: cp1y + perpY * perpShift,
          },
          nodeMidShifted: {
            x: nodeMidX + perpX * perpShift,
            y: nodeMidY + perpY * perpShift,
          },
          cp2Shifted: {
            x: cp2x + perpX * perpShift,
            y: cp2y + perpY * perpShift,
          },
        }
      }

      if (isReverseComplementLoop) {
        const startX = fromEnd.x + offsetX
        const startY = fromEnd.y + offsetY
        const extensionLength = 25 / scale
        const cpX = startX + segmentDirX * extensionLength
        const cpY = startY + segmentDirY * extensionLength
        const pathMidX = startX + (cpX - startX) * 3
        const pathMidY = startY + (cpY - startY) * 3
        const perpX = -segmentDirY
        const perpY = segmentDirX
        const perpendicularShift = extensionLength * 1.5

        return {
          kind: 'reverse-complement-loop' as const,
          start: { x: startX, y: startY },
          end: { x: startX, y: startY },
          controlPoint1: { x: cpX, y: cpY },
          controlPoint2: { x: cpX, y: cpY },
          pathMidPoint: { x: pathMidX, y: pathMidY },
          pathMidShifted: {
            x: pathMidX + perpX * perpendicularShift,
            y: pathMidY + perpY * perpendicularShift,
          },
          pathMidShiftedOpposite: {
            x: pathMidX - perpX * perpendicularShift,
            y: pathMidY - perpY * perpendicularShift,
          },
        }
      }

      let fromPrev = fromSegments[fromSegments.length - 2]
      if (!fromPrev) {
        fromPrev = fromSegments[0]
      }

      let toNext = toSegments[1]
      if (!toNext) {
        toNext = toSegments[0]
      }

      const distance = Math.hypot(toStart.x - fromEnd.x, toStart.y - fromEnd.y)
      const projectionDistance = Math.min(distance * 0.5, 80 / scale)

      const projectLine = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        distance: number,
      ): [number, number] => {
        const d = Math.hypot(y2 - y1, x2 - x1)
        if (d === 0) return [x2, y2]
        const vx = (x2 - x1) / d
        const vy = (y2 - y1) / d
        return [x2 + distance * vx, y2 + distance * vy]
      }

      const [cp1x, cp1y] = projectLine(
        fromPrev.x,
        fromPrev.y,
        fromEnd.x,
        fromEnd.y,
        projectionDistance,
      )
      const [cp2x, cp2y] = projectLine(
        toNext.x,
        toNext.y,
        toStart.x,
        toStart.y,
        projectionDistance,
      )

      return {
        kind: 'regular' as const,
        start: { x: fromEnd.x + offsetX, y: fromEnd.y + offsetY },
        end: { x: toStart.x + offsetX, y: toStart.y + offsetY },
        controlPoint1: { x: cp1x + offsetX, y: cp1y + offsetY },
        controlPoint2: { x: cp2x + offsetX, y: cp2y + offsetY },
      }
    },
    [getDisplayNodeSegments],
  )

  const getEdgeOffsetNormal = useCallback((edge: Graph['edges'][number]) => {
    const fromSegments = getDisplayNodeSegments(edge.from)
    const toSegments = getDisplayNodeSegments(edge.to)

    if (!fromSegments || !toSegments || fromSegments.length === 0 || toSegments.length === 0) {
      return null
    }

    const fromEnd = fromSegments[fromSegments.length - 1]
    const toStart = toSegments[0]
    if (!fromEnd || !toStart) return null

    let dx = toStart.x - fromEnd.x
    let dy = toStart.y - fromEnd.y
    let len = Math.hypot(dx, dy)

    if (len === 0 && fromSegments.length >= 2) {
      const prevSeg = fromSegments[fromSegments.length - 2]!
      dx = fromEnd.x - prevSeg.x
      dy = fromEnd.y - prevSeg.y
      len = Math.hypot(dx, dy)
    }

    if (len === 0) return null

    return {
      x: -dy / len,
      y: dx / len,
    }
  }, [getDisplayNodeSegments])

  // Drawing function
  const draw = useCallback(() => {
    if (!layoutResult || !canvasRef.current || !boundsRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas resolution (force redraw by resetting dimensions)
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    ctx.scale(dpr, dpr)

    // Clear canvas with theme-appropriate background
    ctx.fillStyle = isDarkMode ? '#1a1a1a' : '#ffffff'
    ctx.fillRect(0, 0, width, height)

    const { scale, rotation, translateX, translateY } = transform
    // Cache the trigonometric values once per redraw instead of recomputing
    // them for every node segment and edge control point.
    const rotationCosine = Math.cos(rotation)
    const rotationSine = Math.sin(rotation)

    // Apply uniform scale, viewport rotation, and screen translation to each
    // graph-space point.
    const transformPoint = (x: number, y: number) => {
      const scaledX = x * scale
      const scaledY = y * scale
      return {
        x:
          scaledX * rotationCosine -
          scaledY * rotationSine +
          translateX,
        y:
          scaledX * rotationSine +
          scaledY * rotationCosine +
          translateY,
      }
    }

    // Helper function to draw an arrowhead at a point
    const drawArrowhead = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      angle: number,
      color: string,
      size: number = 12,
    ) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-size, -size / 2)
      ctx.lineTo(-size, size / 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    const addAlphaToColor = (color: string, alpha: number): string => {
      if (color.startsWith('#')) {
        const alphaHex = Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')
        if (color.length === 4) {
          const r = color[1]
          const g = color[2]
          const b = color[3]
          return `#${r}${r}${g}${g}${b}${b}${alphaHex}`
        }
        return `${color}${alphaHex}`
      }

      if (color.startsWith('rgb(')) {
        return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
      }

      if (color.startsWith('hsl(')) {
        return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`)
      }

      return color
    }

    // Base graph edges are drawn without arrowheads, but path traversals still
    // keep them so directionality is visible only in the path overlay layer.
    const drawEdge = (
      edge: (typeof graph.edges)[0],
      offsetX: number,
      offsetY: number,
      color: string,
      lineWidth: number,
      showArrowhead: boolean,
    ) => {
      const geometry = buildEdgeGeometry(edge, offsetX, offsetY, scale)
      if (!geometry) return

      ctx.strokeStyle = addAlphaToColor(color, 0.85)
      ctx.lineWidth = lineWidth
      const strokeColor = addAlphaToColor(color, 0.85)

      if (geometry.kind === 'self-loop') {
        const startLocation = transformPoint(geometry.start.x, geometry.start.y)
        const endLocation = transformPoint(geometry.end.x, geometry.end.y)
        const controlPoint1 = transformPoint(
          geometry.controlPoint1.x,
          geometry.controlPoint1.y,
        )
        const controlPoint2 = transformPoint(
          geometry.controlPoint2.x,
          geometry.controlPoint2.y,
        )
        const cp1Shifted = transformPoint(
          geometry.cp1Shifted.x,
          geometry.cp1Shifted.y,
        )
        const nodeMidShifted = transformPoint(
          geometry.nodeMidShifted.x,
          geometry.nodeMidShifted.y,
        )
        const cp2Shifted = transformPoint(
          geometry.cp2Shifted.x,
          geometry.cp2Shifted.y,
        )

        ctx.beginPath()
        ctx.moveTo(startLocation.x, startLocation.y)
        ctx.bezierCurveTo(
          controlPoint1.x,
          controlPoint1.y,
          cp1Shifted.x,
          cp1Shifted.y,
          nodeMidShifted.x,
          nodeMidShifted.y,
        )
        ctx.bezierCurveTo(
          cp2Shifted.x,
          cp2Shifted.y,
          controlPoint2.x,
          controlPoint2.y,
          endLocation.x,
          endLocation.y,
        )
        ctx.stroke()

        if (showArrowhead) {
          const angle = Math.atan2(
            endLocation.y - controlPoint2.y,
            endLocation.x - controlPoint2.x,
          )
          drawArrowhead(ctx, endLocation.x, endLocation.y, angle, strokeColor)
        }
      } else if (geometry.kind === 'reverse-complement-loop') {
        const startLocation = transformPoint(geometry.start.x, geometry.start.y)
        const endLocation = transformPoint(geometry.end.x, geometry.end.y)
        const controlPoint1 = transformPoint(
          geometry.controlPoint1.x,
          geometry.controlPoint1.y,
        )
        const controlPoint2 = transformPoint(
          geometry.controlPoint2.x,
          geometry.controlPoint2.y,
        )
        const pathMidPoint = transformPoint(
          geometry.pathMidPoint.x,
          geometry.pathMidPoint.y,
        )
        const pathMidShifted = transformPoint(
          geometry.pathMidShifted.x,
          geometry.pathMidShifted.y,
        )
        const pathMidShiftedOpposite = transformPoint(
          geometry.pathMidShiftedOpposite.x,
          geometry.pathMidShiftedOpposite.y,
        )

        ctx.beginPath()
        ctx.moveTo(startLocation.x, startLocation.y)
        ctx.bezierCurveTo(
          controlPoint1.x,
          controlPoint1.y,
          pathMidShifted.x,
          pathMidShifted.y,
          pathMidPoint.x,
          pathMidPoint.y,
        )
        ctx.bezierCurveTo(
          pathMidShiftedOpposite.x,
          pathMidShiftedOpposite.y,
          controlPoint2.x,
          controlPoint2.y,
          endLocation.x,
          endLocation.y,
        )
        ctx.stroke()

        if (showArrowhead) {
          const angle = Math.atan2(
            endLocation.y - pathMidShiftedOpposite.y,
            endLocation.x - pathMidShiftedOpposite.x,
          )
          drawArrowhead(ctx, endLocation.x, endLocation.y, angle, strokeColor)
        }
      } else {
        const p1 = transformPoint(geometry.start.x, geometry.start.y)
        const p2 = transformPoint(geometry.end.x, geometry.end.y)
        const cp1 = transformPoint(
          geometry.controlPoint1.x,
          geometry.controlPoint1.y,
        )
        const cp2 = transformPoint(
          geometry.controlPoint2.x,
          geometry.controlPoint2.y,
        )

        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y)
        ctx.stroke()

        if (showArrowhead) {
          const angle = Math.atan2(p2.y - cp2.y, p2.x - cp2.x)
          drawArrowhead(ctx, p2.x, p2.y, angle, strokeColor)
        }
      }
    }

    // Draw single-mode base edges and then directional path overlays on top of
    // the same canonical geometry.
    displayGraph.edges.forEach((displayEdge, edgeIdx) => {
      const isHovered = hoveredEdge === edgeIdx
      const visiblePathTraversals = getVisiblePathTraversals(
        displayEdge.pathTraversals,
      )
      const numPaths = visiblePathTraversals.length

      if (!drawPaths || numPaths === 0) {
        const edgeColor = isHovered ? '#aaa' : '#777'
        const lineWidth = isHovered
          ? connectorThickness + 1
          : connectorThickness
        drawEdge(
          displayEdge.representativeEdge,
          0,
          0,
          edgeColor,
          lineWidth,
          false,
        )
      } else {
        const offsetNormal = getEdgeOffsetNormal(displayEdge.representativeEdge)

        visiblePathTraversals.forEach((traversal, pathIdx) => {
          const offset = getEdgeOffset(pathIdx, numPaths, scale)
          const offsetX = (offsetNormal?.x ?? 0) * offset
          const offsetY = (offsetNormal?.y ?? 0) * offset
          const color = pathColors.get(traversal.pathId) ?? '#888'
          const lineWidth = isHovered
            ? connectorThickness + 1
            : connectorThickness

          drawEdge(
            traversal.edge,
            offsetX,
            offsetY,
            color,
            lineWidth,
            true,
          )
        })
      }
    })

    // DEBUG: Draw edge hit areas in transparent pink
    if (debugHitboxes) {
      const edgeThreshold = 10 / scale

      displayGraph.edges.forEach(displayEdge => {
        const visiblePathTraversals = getVisiblePathTraversals(
          displayEdge.pathTraversals,
        )
        const numPaths = visiblePathTraversals.length

        // Helper to draw hit area for edge with offset
        const drawHitArea = (
          edge: (typeof graph.edges)[0],
          offsetX: number,
          offsetY: number,
        ) => {
          const geometry = buildEdgeGeometry(edge, offsetX, offsetY, scale)
          if (!geometry) return

          ctx.strokeStyle = 'rgba(255, 105, 180, 0.3)'
          ctx.lineWidth = edgeThreshold * scale
          ctx.beginPath()

          if (geometry.kind === 'self-loop') {
            const p1 = transformPoint(geometry.start.x, geometry.start.y)
            const cp1 = transformPoint(
              geometry.controlPoint1.x,
              geometry.controlPoint1.y,
            )
            const cp1s = transformPoint(
              geometry.cp1Shifted.x,
              geometry.cp1Shifted.y,
            )
            const mid = transformPoint(
              geometry.nodeMidShifted.x,
              geometry.nodeMidShifted.y,
            )
            const cp2s = transformPoint(
              geometry.cp2Shifted.x,
              geometry.cp2Shifted.y,
            )
            const cp2 = transformPoint(
              geometry.controlPoint2.x,
              geometry.controlPoint2.y,
            )
            const p2 = transformPoint(geometry.end.x, geometry.end.y)
            ctx.moveTo(p1.x, p1.y)
            ctx.bezierCurveTo(cp1.x, cp1.y, cp1s.x, cp1s.y, mid.x, mid.y)
            ctx.bezierCurveTo(cp2s.x, cp2s.y, cp2.x, cp2.y, p2.x, p2.y)
          } else if (geometry.kind === 'reverse-complement-loop') {
            const p1 = transformPoint(geometry.start.x, geometry.start.y)
            const cp1 = transformPoint(
              geometry.controlPoint1.x,
              geometry.controlPoint1.y,
            )
            const cp2 = transformPoint(
              geometry.controlPoint2.x,
              geometry.controlPoint2.y,
            )
            const mid = transformPoint(
              geometry.pathMidPoint.x,
              geometry.pathMidPoint.y,
            )
            const mids = transformPoint(
              geometry.pathMidShifted.x,
              geometry.pathMidShifted.y,
            )
            const midsOpposite = transformPoint(
              geometry.pathMidShiftedOpposite.x,
              geometry.pathMidShiftedOpposite.y,
            )
            const p2 = transformPoint(geometry.end.x, geometry.end.y)
            ctx.moveTo(p1.x, p1.y)
            ctx.bezierCurveTo(cp1.x, cp1.y, mids.x, mids.y, mid.x, mid.y)
            ctx.bezierCurveTo(
              midsOpposite.x,
              midsOpposite.y,
              cp2.x,
              cp2.y,
              p2.x,
              p2.y,
            )
          } else {
            const p1 = transformPoint(geometry.start.x, geometry.start.y)
            const cp1 = transformPoint(
              geometry.controlPoint1.x,
              geometry.controlPoint1.y,
            )
            const cp2 = transformPoint(
              geometry.controlPoint2.x,
              geometry.controlPoint2.y,
            )
            const p2 = transformPoint(geometry.end.x, geometry.end.y)
            ctx.moveTo(p1.x, p1.y)
            ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y)
          }

          ctx.stroke()
        }

        if (!drawPaths || numPaths === 0) {
          drawHitArea(displayEdge.representativeEdge, 0, 0)
        } else {
          const offsetNormal = getEdgeOffsetNormal(displayEdge.representativeEdge)

          visiblePathTraversals.forEach((traversal, pathIdx) => {
            const offset = getEdgeOffset(pathIdx, numPaths, scale)
            const offsetX = (offsetNormal?.x ?? 0) * offset
            const offsetY = (offsetNormal?.y ?? 0) * offset
            drawHitArea(traversal.edge, offsetX, offsetY)
          })
        }
      })
    }

    // Draw one visible node per contig rather than one node per orientation.
    displayGraph.nodes.forEach(displayNode => {
      const { representativeId, node, segments } = displayNode
      if (segments.length === 0) return

      // Get color based on selected scheme
      const color = getNodeColor(node)

      const isHovered = hoveredNode === representativeId
      const isSelected = selectedNode === representativeId

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      segments.forEach((segment, i) => {
        const p = transformPoint(segment.x, segment.y)
        if (i === 0) {
          ctx.moveTo(p.x, p.y)
        } else {
          ctx.lineTo(p.x, p.y)
        }
      })

      if (isSelected) {
        ctx.strokeStyle = isDarkMode ? '#ffd54f' : '#b45309'
        ctx.lineWidth = contigThickness + 8
        ctx.stroke()
      }

      ctx.strokeStyle = `rgb(${color.join(',')})`
      ctx.lineWidth = isHovered ? contigThickness + 1 : contigThickness
      ctx.stroke()

      // Draw node label if labels are enabled and node is long enough
      if (
        drawLabels &&
        node.length >= labelLengthThreshold &&
        segments.length > 0
      ) {
        const midIdx = Math.floor(segments.length / 2)
        const midPoint = transformPoint(
          segments[midIdx]!.x,
          segments[midIdx]!.y,
        )

        ctx.fillStyle = isDarkMode ? '#fff' : '#000'
        ctx.font = '10px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(node.name, midPoint.x, midPoint.y - 5)
      }
    })
  }, [
    layoutResult,
    graph,
    width,
    height,
    transform,
    hoveredNode,
    hoveredEdge,
    selectedNode,
    isDarkMode,
    getNodeColor,
    displayGraph,
    pathColors,
    getVisiblePathTraversals,
    buildEdgeGeometry,
    getEdgeOffset,
    getEdgeOffsetNormal,
    contigThickness,
    connectorThickness,
    drawLabels,
    labelLengthThreshold,
    drawPaths,
    visiblePathIds,
  ])

  // Redraw when any state changes
  useEffect(() => {
    draw()
  }, [draw])

  // Add wheel event listener with passive: false to prevent page scroll
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const prev = transformRef.current

      if (e.altKey) {
        // Alt+wheel rotates around the canvas center, keeping the view stable
        // instead of orbiting around a changing pointer location.
        const wheelDeltaPixels = getWheelDeltaPixels(e, height)
        const rotationDelta = Math.max(
          -MAX_ROTATION_STEP,
          Math.min(
            MAX_ROTATION_STEP,
            wheelDeltaPixels * ROTATION_RADIANS_PER_PIXEL,
          ),
        )
        if (Math.abs(rotationDelta) < 0.0001) return

        const pivotX = width / 2
        const pivotY = height / 2
        const deltaCosine = Math.cos(rotationDelta)
        const deltaSine = Math.sin(rotationDelta)
        const translationFromPivotX = prev.translateX - pivotX
        const translationFromPivotY = prev.translateY - pivotY
        const nextTransform = {
          ...prev,
          rotation: normalizeRotation(prev.rotation + rotationDelta),
          // Rotate the existing screen translation around the same pivot so
          // graph content does not jump while the angle changes.
          translateX:
            pivotX +
            translationFromPivotX * deltaCosine -
            translationFromPivotY * deltaSine,
          translateY:
            pivotY +
            translationFromPivotX * deltaSine +
            translationFromPivotY * deltaCosine,
        }

        transformRef.current = nextTransform
        setTransform(nextTransform)
        // Hover geometry moves during rotation, so discard stale tooltips
        // until the pointer moves and hit-testing runs again.
        setHoveredNode(null)
        setHoveredEdge(null)
        return
      }

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const delta = -e.deltaY * 0.001
      const scaleFactor = Math.exp(delta)

      const newScale = clampZoom(prev.scale * scaleFactor)
      if (Math.abs(newScale - prev.scale) < 0.0001) return

      const actualFactor = newScale / prev.scale

      const nextTransform = {
        // Ordinary wheel zoom keeps the current viewport rotation.
        ...prev,
        scale: newScale,
        translateX: mouseX - (mouseX - prev.translateX) * actualFactor,
        translateY: mouseY - (mouseY - prev.translateY) * actualFactor,
      }

      transformRef.current = nextTransform
      setTransform(nextTransform)
      reportInternalZoom(newScale)
    }

    canvas.addEventListener('wheel', wheelHandler, { passive: false })
    return () => canvas.removeEventListener('wheel', wheelHandler)
  }, [height, reportInternalZoom, width])

  // Hit detection helper - distance from point to line segment
  const distanceToSegment = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number => {
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy

    if (lenSq === 0) return Math.hypot(px - x1, py - y1)

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))

    const closestX = x1 + t * dx
    const closestY = y1 + t * dy

    return Math.hypot(px - closestX, py - closestY)
  }

  // Hit detection helper - distance from point to cubic bezier curve
  const distanceToCubicBezier = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    cx1: number,
    cy1: number,
    cx2: number,
    cy2: number,
    x2: number,
    y2: number,
  ): number => {
    // Sample points along the bezier curve and find minimum distance
    let minDist = Infinity
    const samples = 20 // Number of samples along the curve

    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const oneMinusT = 1 - t

      // Cubic bezier formula: B(t) = (1-t)^3 * P0 + 3(1-t)^2*t * P1 + 3(1-t)*t^2 * P2 + t^3 * P3
      const bx =
        oneMinusT * oneMinusT * oneMinusT * x1 +
        3 * oneMinusT * oneMinusT * t * cx1 +
        3 * oneMinusT * t * t * cx2 +
        t * t * t * x2
      const by =
        oneMinusT * oneMinusT * oneMinusT * y1 +
        3 * oneMinusT * oneMinusT * t * cy1 +
        3 * oneMinusT * t * t * cy2 +
        t * t * t * y2

      const dist = Math.hypot(px - bx, py - by)
      minDist = Math.min(minDist, dist)
    }

    return minDist
  }

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 0) {
        // Left click
        setDragStart({ x: e.clientX, y: e.clientY })
        setContextMenu({ visible: false, x: 0, y: 0, nodeId: null })

        if (hoveredNode) {
          // Prepare for node dragging
          setDraggingNodeId(hoveredNode)
          setSelectedNode(hoveredNode)
        } else {
          setSelectedNode(null)
          // Prepare for view panning
          setIsDragging(true)
        }
      }
    },
    [hoveredNode],
  )

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layoutResult || !canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      if (draggingNodeId) {
        // Node dragging - start dragging on first movement
        if (!isDraggingNode) {
          setIsDraggingNode(true)
          // Initialize modified positions if not already done
          if (!modifiedNodePositions) {
            setModifiedNodePositions({ ...layoutResult.nodePositions })
          }
        }

        const screenDeltaX = e.clientX - dragStart.x
        const screenDeltaY = e.clientY - dragStart.y
        const inverseRotationCosine = Math.cos(transform.rotation)
        const inverseRotationSine = Math.sin(transform.rotation)
        // Undo viewport rotation and scale so dragging follows the pointer in
        // graph coordinates at every displayed angle.
        const dx =
          (screenDeltaX * inverseRotationCosine +
            screenDeltaY * inverseRotationSine) /
          transform.scale
        const dy =
          (-screenDeltaX * inverseRotationSine +
            screenDeltaY * inverseRotationCosine) /
          transform.scale

        setModifiedNodePositions(prev => {
          const current = prev || layoutResult.nodePositions
          const nodeSegments = current[draggingNodeId]
          if (!nodeSegments) return current

          // Translate all segments of this node
          const updatedSegments = nodeSegments.map(seg => ({
            x: seg.x + dx,
            y: seg.y + dy,
          }))

          return {
            ...current,
            [draggingNodeId]: updatedSegments,
          }
        })

        setDragStart({ x: e.clientX, y: e.clientY })
      } else if (isDragging) {
        // View panning
        const dx = e.clientX - dragStart.x
        const dy = e.clientY - dragStart.y

        const prev = transformRef.current
        const nextTransform = {
          ...prev,
          translateX: prev.translateX + dx,
          translateY: prev.translateY + dy,
        }

        transformRef.current = nextTransform
        setTransform(nextTransform)

        setDragStart({ x: e.clientX, y: e.clientY })
      } else {
        // Hit detection for hover
        const { scale, rotation, translateX, translateY } = transform
        const translatedMouseX = mouseX - translateX
        const translatedMouseY = mouseY - translateY
        const inverseRotationCosine = Math.cos(rotation)
        const inverseRotationSine = Math.sin(rotation)
        // Invert translation, rotation, and scale so hover hit-testing remains
        // aligned with the rotated graph.
        const graphX =
          (translatedMouseX * inverseRotationCosine +
            translatedMouseY * inverseRotationSine) /
          scale
        const graphY =
          (-translatedMouseX * inverseRotationSine +
            translatedMouseY * inverseRotationCosine) /
          scale

        // Check nodes
        let foundNode: string | null = null
        const nodeThreshold = 5 / scale // Adjust with zoom

        for (const displayNode of displayGraph.nodes) {
          const { representativeId, segments } = displayNode
          for (let i = 0; i < segments.length - 1; i++) {
            const dist = distanceToSegment(
              graphX,
              graphY,
              segments[i]!.x,
              segments[i]!.y,
              segments[i + 1]!.x,
              segments[i + 1]!.y,
            )

            if (dist < nodeThreshold) {
              foundNode = representativeId
              break
            }
          }
          if (foundNode) break
        }

        setHoveredNode(foundNode)

        // Update tooltip position
        if (foundNode) {
          setTooltipPosition({ x: e.clientX, y: e.clientY })
          // Update virtual reference element for floating-ui
          refs.setPositionReference({
            getBoundingClientRect: () => ({
              width: 0,
              height: 0,
              x: e.clientX,
              y: e.clientY,
              top: e.clientY,
              left: e.clientX,
              right: e.clientX,
              bottom: e.clientY,
            }),
          })
        }

        // Check edges
        let foundEdge: number | null = null
        const edgeThreshold = 10 / scale

        for (let edgeIdx = 0; edgeIdx < displayGraph.edges.length; edgeIdx++) {
          const displayEdge = displayGraph.edges[edgeIdx]!
          const visiblePathTraversals = getVisiblePathTraversals(
            displayEdge.pathTraversals,
          )
          const numPaths = visiblePathTraversals.length

          let dist: number

          // Hit testing mirrors the exact Bezier geometry used in drawEdge()
          // so the collapsed single-mode display stays clickable.
          const checkEdgeDistance = (
            edge: (typeof graph.edges)[0],
            offsetX: number,
            offsetY: number,
          ): number => {
            const geometry = buildEdgeGeometry(edge, offsetX, offsetY, scale)
            if (!geometry) return Infinity

            if (geometry.kind === 'self-loop') {
              const dist1 = distanceToCubicBezier(
                graphX,
                graphY,
                geometry.start.x,
                geometry.start.y,
                geometry.controlPoint1.x,
                geometry.controlPoint1.y,
                geometry.cp1Shifted.x,
                geometry.cp1Shifted.y,
                geometry.nodeMidShifted.x,
                geometry.nodeMidShifted.y,
              )

              const dist2 = distanceToCubicBezier(
                graphX,
                graphY,
                geometry.nodeMidShifted.x,
                geometry.nodeMidShifted.y,
                geometry.cp2Shifted.x,
                geometry.cp2Shifted.y,
                geometry.controlPoint2.x,
                geometry.controlPoint2.y,
                geometry.end.x,
                geometry.end.y,
              )

              return Math.min(dist1, dist2)
            }

            if (geometry.kind === 'reverse-complement-loop') {
              const dist1 = distanceToCubicBezier(
                graphX,
                graphY,
                geometry.start.x,
                geometry.start.y,
                geometry.controlPoint1.x,
                geometry.controlPoint1.y,
                geometry.pathMidShifted.x,
                geometry.pathMidShifted.y,
                geometry.pathMidPoint.x,
                geometry.pathMidPoint.y,
              )
              const dist2 = distanceToCubicBezier(
                graphX,
                graphY,
                geometry.pathMidPoint.x,
                geometry.pathMidPoint.y,
                geometry.pathMidShiftedOpposite.x,
                geometry.pathMidShiftedOpposite.y,
                geometry.controlPoint2.x,
                geometry.controlPoint2.y,
                geometry.end.x,
                geometry.end.y,
              )
              return Math.min(dist1, dist2)
            }

            return distanceToCubicBezier(
              graphX,
              graphY,
              geometry.start.x,
              geometry.start.y,
              geometry.controlPoint1.x,
              geometry.controlPoint1.y,
              geometry.controlPoint2.x,
              geometry.controlPoint2.y,
              geometry.end.x,
              geometry.end.y,
            )
          }

          if (!drawPaths || numPaths === 0) {
            dist = checkEdgeDistance(displayEdge.representativeEdge, 0, 0)
          } else {
            const offsetNormal = getEdgeOffsetNormal(displayEdge.representativeEdge)
            let minDist = Infinity

            visiblePathTraversals.forEach((traversal, pathIdx) => {
              const offset = getEdgeOffset(pathIdx, numPaths, scale)
              const offsetX = (offsetNormal?.x ?? 0) * offset
              const offsetY = (offsetNormal?.y ?? 0) * offset
              const d = checkEdgeDistance(traversal.edge, offsetX, offsetY)
              minDist = Math.min(minDist, d)
            })
            dist = minDist
          }

          if (dist < edgeThreshold) {
            foundEdge = edgeIdx
            break
          }
        }

        setHoveredEdge(foundEdge)

        // Update tooltip position for edges
        if (foundEdge !== null && !foundNode) {
          setTooltipPosition({ x: e.clientX, y: e.clientY })
          // Update virtual reference element for floating-ui
          refs.setPositionReference({
            getBoundingClientRect: () => ({
              width: 0,
              height: 0,
              x: e.clientX,
              y: e.clientY,
              top: e.clientY,
              left: e.clientX,
              right: e.clientX,
              bottom: e.clientY,
            }),
          })
        }

        // Update cursor
        canvasRef.current.style.cursor =
          foundNode || foundEdge
            ? 'pointer'
            : isDragging || isDraggingNode
              ? 'grabbing'
              : 'default'
      }
    },
    [
      layoutResult,
      isDragging,
      isDraggingNode,
      draggingNodeId,
      dragStart,
      transform,
      graph,
      modifiedNodePositions,
      refs,
      displayGraph,
      buildEdgeGeometry,
      getVisiblePathTraversals,
      getEdgeOffsetNormal,
      getEdgeOffset,
    ],
  )

  // Handle mouse up
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // If we were preparing to drag a node but didn't actually drag, show context menu
      if (draggingNodeId && !isDraggingNode && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setContextMenu({
          visible: true,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          nodeId: draggingNodeId,
        })
      }

      setIsDragging(false)
      setIsDraggingNode(false)
      setDraggingNodeId(null)
    },
    [draggingNodeId, isDraggingNode],
  )

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu.visible) return

    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.context-menu')) {
        setContextMenu({ visible: false, x: 0, y: 0, nodeId: null })
      }
    }

    // Delay attaching the handler to avoid immediate closure
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  // Close details dialog with Escape key
  useEffect(() => {
    if (!detailsDialog.visible) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetailsDialog({ visible: false, nodeId: null })
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [detailsDialog.visible])

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          border: isDarkMode ? '1px solid #333' : '1px solid #ddd',
          borderRadius: '8px',
          backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
          cursor: 'default',
          display: 'block',
        }}
      />

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{
            position: 'absolute',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            background: isDarkMode ? '#2a2a2a' : 'white',
            border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            zIndex: 1000,
            minWidth: '150px',
          }}
        >
          <button
            onClick={e => {
              e.stopPropagation()
              setDetailsDialog({ visible: true, nodeId: contextMenu.nodeId })
              setContextMenu({ visible: false, x: 0, y: 0, nodeId: null })
            }}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '13px',
              color: isDarkMode ? '#e0e0e0' : '#333',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = isDarkMode
                ? '#3a3a3a'
                : '#f0f0f0'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            View Details
          </button>
          {onUseAsStartNode && (
            <button
              onClick={e => {
                e.stopPropagation()
                const node = graph.nodes.find(
                  candidate => candidate.id === contextMenu.nodeId,
                )
                if (node) {
                  onUseAsStartNode(node.name)
                }
                setContextMenu({
                  visible: false,
                  x: 0,
                  y: 0,
                  nodeId: null,
                })
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderTop: isDarkMode
                  ? '1px solid #444'
                  : '1px solid #ddd',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '13px',
                color: isDarkMode ? '#e0e0e0' : '#333',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = isDarkMode
                  ? '#3a3a3a'
                  : '#f0f0f0'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Use as Start Node
            </button>
          )}
        </div>
      )}

      {/* Details dialog */}
      {detailsDialog.visible &&
        (() => {
          const node = graph.nodes.find(n => n.id === detailsDialog.nodeId)
          if (!node) return null
          const nodeSequence = getNodeSequence(node)

          return (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
              onClick={() => setDetailsDialog({ visible: false, nodeId: null })}
            >
              <div
                style={{
                  background: isDarkMode ? '#2a2a2a' : 'white',
                  borderRadius: '8px',
                  padding: '20px',
                  maxWidth: '500px',
                  width: '90%',
                  color: isDarkMode ? '#e0e0e0' : '#333',
                }}
                onClick={e => e.stopPropagation()}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '15px',
                    borderBottom: isDarkMode
                      ? '1px solid #444'
                      : '1px solid #ddd',
                    paddingBottom: '10px',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Node Details</h3>
                  <button
                    onClick={() =>
                      setDetailsDialog({ visible: false, nodeId: null })
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '24px',
                      cursor: 'pointer',
                      color: isDarkMode ? '#aaa' : '#666',
                      padding: 0,
                      width: '30px',
                      height: '30px',
                    }}
                  >
                    ×
                  </button>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div>
                    <strong>ID:</strong> {node.name}
                  </div>
                  <div>
                    <strong>Length:</strong> {node.length.toLocaleString()} bp
                  </div>
                  <div>
                    <strong>Depth:</strong> {node.depth.toFixed(2)}×
                  </div>
                  <div>
                    <strong>Sequence:</strong>{' '}
                    {nodeSequence ? (
                      <span
                        style={{
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          wordBreak: 'break-all',
                        }}
                      >
                        {formatSequencePreview(nodeSequence)}
                      </span>
                    ) : (
                      'Not available'
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Tooltip for nodes */}
      {hoveredNode &&
        !isDragging &&
        !isDraggingNode &&
        (() => {
          const node = graph.nodes.find(n => n.id === hoveredNode)
          if (!node) return null

          return (
            <div
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                position: 'absolute',
                background: isDarkMode ? '#2a2a2a' : 'white',
                border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                zIndex: 1000,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ color: isDarkMode ? '#fff' : '#000' }}>
                <div>
                  <strong>{node.name}</strong>
                </div>
                <div
                  style={{ fontSize: '11px', marginTop: '4px', opacity: 0.8 }}
                >
                  {node.length.toLocaleString()} bp • {node.depth.toFixed(2)}×
                  depth
                </div>
              </div>
            </div>
          )
        })()}

      {/* Tooltip for edges */}
      {hoveredEdge !== null &&
        !hoveredNode &&
        !isDragging &&
        !isDraggingNode &&
        (() => {
          const edge = displayGraph.edges[hoveredEdge]
          if (!edge) return null

          const fromNode = displayGraph.nodesByKey.get(edge.fromNodeKey)?.node
          const toNode = displayGraph.nodesByKey.get(edge.toNodeKey)?.node
          if (!fromNode || !toNode) return null

          const visiblePathTraversals = getVisiblePathTraversals(
            edge.pathTraversals,
          )
          const visibleEdgePathIdSet = new Set(
            visiblePathTraversals.map(traversal => traversal.pathId),
          )
          const visibleEdgePathIds = Array.from(visibleEdgePathIdSet)

          // Path overlays are directional even though the base graph edge is
          // drawn as one collapsed connection. Always group every traversal
          // for the tooltip; path visibility affects only the status/count.
          const pathDirectionGroups = Array.from(
            edge.pathTraversals.reduce(
              (groups, traversal) => {
                const directionKey = `${traversal.edge.from}->${traversal.edge.to}`
                const existingGroup = groups.get(directionKey)

                if (existingGroup) {
                  existingGroup.pathIds.add(traversal.pathId)
                } else {
                  groups.set(directionKey, {
                    from: traversal.edge.from,
                    to: traversal.edge.to,
                    pathIds: new Set([traversal.pathId]),
                  })
                }

                return groups
              },
              new Map<
                string,
                { from: string; to: string; pathIds: Set<string> }
              >(),
            ).values(),
          ).map(group => ({
            ...group,
            pathIds: Array.from(group.pathIds),
          }))

          return (
            <div
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                position: 'absolute',
                background: isDarkMode ? '#2a2a2a' : 'white',
                border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                zIndex: 1000,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ color: isDarkMode ? '#fff' : '#000' }}>
                <div>
                  <strong>Connection</strong>
                </div>
                <div
                  style={{ fontSize: '11px', marginTop: '4px', opacity: 0.8 }}
                >
                  {fromNode.name} — {toNode.name}
                </div>
                {edge.pathIds.length > 0 && (
                  <div
                    style={{
                      fontSize: '11px',
                      marginTop: '6px',
                      paddingTop: '6px',
                      borderTop: isDarkMode
                        ? '1px solid #444'
                        : '1px solid #ddd',
                    }}
                  >
                    <div style={{ marginBottom: '3px', opacity: 0.9 }}>
                      <strong>
                        Paths ({visibleEdgePathIds.length} visible /{' '}
                        {edge.pathIds.length} total):
                      </strong>
                    </div>
                    {pathDirectionGroups.map(group => (
                      <div
                        key={`${group.from}->${group.to}`}
                        style={{ marginTop: '5px' }}
                      >
                        <div style={{ marginLeft: '8px', opacity: 0.9 }}>
                          <strong>
                            {group.from} → {group.to}
                          </strong>
                        </div>
                        {group.pathIds.map(pathId => (
                          <div
                            key={`${group.from}->${group.to}:${pathId}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginLeft: '18px',
                              opacity: visibleEdgePathIdSet.has(pathId)
                                ? 0.9
                                : 0.55,
                            }}
                          >
                            <div
                              style={{
                                width: '12px',
                                height: '12px',
                                backgroundColor: getPathColor(pathId),
                                borderRadius: '2px',
                                flexShrink: 0,
                              }}
                            />
                            {pathId}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
    </div>
  )
}

export const GraphCanvas = memo(GraphCanvasComponent)
