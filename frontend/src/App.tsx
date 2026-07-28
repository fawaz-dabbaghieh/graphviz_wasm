import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { GraphCanvas } from './components/GraphCanvas'
import { LengthDistribution } from './components/LengthDistribution'
import { LayoutControls } from './components/LayoutControls'
import { PathsLegend } from './components/PathsLegend'
import { StatsPanel } from './components/StatsPanel'
import { GraphExtractionControls } from './components/GraphExtractionControls'
import { BedAnnotationPanel } from './components/BedAnnotationPanel'
import { urlExamples } from './data/urlExamples'
import { BandageLayoutWorker } from './utils/BandageLayoutWorker'
import { parseGFA } from './utils/gfaParser'
import { convertGFAToGraph } from './utils/gfaConverter'
import { stripNodeOrientation } from './utils/displayGraph'
import { clampZoom } from './utils/zoom'
import type {
  LayoutOptions,
  LayoutResult,
  ColorScheme,
  Graph,
  IndexedGraph,
  IndexedAnnotation,
  RegionPath,
  BedAnnotation,
} from './types'
import './App.css'

interface AppProps {
  worker: BandageLayoutWorker
}

async function readBackendError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const errorBody = (await response.json()) as { detail?: unknown }

    // FastAPI returns either a string detail from our HTTPException or a
    // validation array from Pydantic. Flatten both into readable UI text.
    return typeof errorBody.detail === 'string'
      ? errorBody.detail
      : JSON.stringify(errorBody.detail)
  }

  return response.text()
}

function getDefaultBackendUrl(): string {
  return (
    localStorage.getItem('backendUrl') ||
    import.meta.env.VITE_BACKEND_URL ||
    'http://localhost:8000'
  )
}

function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

const LOCAL_GRAPH_ID_PREFIX = '__local_graph__:'

function App({ worker }: AppProps) {
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>({
    quality: 2,
    linearLayout: false,
    componentSeparation: 15.0,
    aspectRatio: 1.5,
    nodeLengthPerMegabase: 2000.0,
    minimumNodeLength: 3.0,
    nodeSegmentLength: 5.0,
    edgeLength: 2.0,
  })
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null)
  const [layoutDuration, setLayoutDuration] = useState<number | null>(null)
  const [isComputing, setIsComputing] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [examplesMenuOpen, setExamplesMenuOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [statsDialogOpen, setStatsDialogOpen] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentGraph, setCurrentGraph] = useState<Graph | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved !== null ? JSON.parse(saved) : true
  })
  const [colorScheme, setColorScheme] = useState<ColorScheme>('uniform')
  const [zoom, setZoom] = useState<number>(1)
  const [zoomRequestId, setZoomRequestId] = useState(0)
  const [displayZoom, setDisplayZoom] = useState<number>(1)
  const [nodeLocatorInput, setNodeLocatorInput] = useState('')
  const [nodeLocatorError, setNodeLocatorError] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [focusNodeRequestId, setFocusNodeRequestId] = useState(0)
  const [contigThickness, setContigThickness] = useState<number>(6)
  const [connectorThickness, setConnectorThickness] = useState<number>(3)
  const [drawLabels, setDrawLabels] = useState<boolean>(false)
  const [labelLengthThreshold, setLabelLengthThreshold] = useState<number>(0)
  const [drawPaths, setDrawPaths] = useState<boolean>(false)
  // Keep path visibility in the React layer so toggling paths never requires
  // recomputing the layout itself.
  const [selectedPathNames, setSelectedPathNames] = useState<string[]>([])
  const [nodeColorOverrides, setNodeColorOverrides] = useState<
    Record<string, string>
  >({})
  const [indexedGraphs, setIndexedGraphs] = useState<IndexedGraph[]>([])
  const [selectedIndexedGraph, setSelectedIndexedGraph] = useState('')
  const [localGraphOption, setLocalGraphOption] =
    useState<IndexedGraph | null>(null)
  const [isLoadingIndexedGraphs, setIsLoadingIndexedGraphs] = useState(false)
  const [indexedGraphError, setIndexedGraphError] = useState<string | null>(null)
  const [regionPaths, setRegionPaths] = useState<RegionPath[]>([])
  const [selectedRegionPathIndex, setSelectedRegionPathIndex] = useState(0)
  const [isLoadingRegionPaths, setIsLoadingRegionPaths] = useState(false)
  const [regionPathError, setRegionPathError] = useState<string | null>(null)
  const [subgraphStartNode, setSubgraphStartNode] = useState('')
  const [extractionMaxNodes, setExtractionMaxNodes] = useState('200')
  const [manualRegionReference, setManualRegionReference] = useState('')
  const [manualRegionSequence, setManualRegionSequence] = useState('')
  const [regionStart, setRegionStart] = useState('')
  const [regionEnd, setRegionEnd] = useState('')
  const [isExtractingSubgraph, setIsExtractingSubgraph] = useState(false)
  const [rightPanelView, setRightPanelView] = useState<
    'graph' | 'annotations'
  >('graph')
  const [bedAnnotations, setBedAnnotations] = useState<BedAnnotation[]>([])
  const [selectedBedAnnotation, setSelectedBedAnnotation] =
    useState<BedAnnotation | null>(null)
  const [indexedAnnotations, setIndexedAnnotations] = useState<
    IndexedAnnotation[]
  >([])
  const [isLoadingIndexedAnnotations, setIsLoadingIndexedAnnotations] =
    useState(false)
  const [indexedAnnotationError, setIndexedAnnotationError] = useState<
    string | null
  >(null)
  const [isLoadingAnnotationFile, setIsLoadingAnnotationFile] = useState(false)
  const [backendUrl, setBackendUrl] = useState(getDefaultBackendUrl)
  const [backendUrlInput, setBackendUrlInput] = useState(getDefaultBackendUrl)

  const graphSelectionOptions = useMemo(() => {
    if (!localGraphOption) return indexedGraphs

    return [
      localGraphOption,
      ...indexedGraphs.filter(graph => graph.id !== localGraphOption.id),
    ]
  }, [indexedGraphs, localGraphOption])

  const selectedGraphSupportsExtraction = useMemo(
    () => indexedGraphs.some(graph => graph.id === selectedIndexedGraph),
    [indexedGraphs, selectedIndexedGraph],
  )

  const selectedGraphIsLocal =
    localGraphOption?.id === selectedIndexedGraph

  // Drop any stale selections from a previous graph load and preserve the
  // current graph's path ordering for the selector.
  const visiblePathNames = useMemo(() => {
    if (!currentGraph?.paths) return []

    const availablePathNames = new Set(currentGraph.paths.map(path => path.name))
    return selectedPathNames.filter(pathName => availablePathNames.has(pathName))
  }, [currentGraph?.paths, selectedPathNames])

  const visiblePathNameSet = useMemo(
    () => new Set(visiblePathNames),
    [visiblePathNames],
  )

  const handleControlZoomChange = useCallback((nextZoom: number) => {
    const clampedZoom = clampZoom(nextZoom)
    setZoom(clampedZoom)
    setZoomRequestId(currentId => currentId + 1)
    setDisplayZoom(clampedZoom)
  }, [])

  const handleCanvasZoomChange = useCallback((nextZoom: number) => {
    setDisplayZoom(clampZoom(nextZoom))
  }, [])

  const handleLocateNode = useCallback(() => {
    const query = nodeLocatorInput.trim()
    if (!query) {
      setNodeLocatorError('Enter a node ID')
      return
    }

    if (!currentGraph || !layoutResult) {
      setNodeLocatorError('Load and lay out a graph first')
      return
    }

    const normalizedQuery = stripNodeOrientation(query)
    const matchingNode =
      currentGraph.nodes.find(
        node => node.id === query || node.name === query,
      ) ??
      currentGraph.nodes.find(
        node => stripNodeOrientation(node.id) === normalizedQuery,
      )

    if (!matchingNode) {
      setNodeLocatorError(`Node "${query}" is not in the current graph`)
      return
    }

    setNodeLocatorError(null)
    setFocusNodeId(matchingNode.id)
    setFocusNodeRequestId(currentId => currentId + 1)
  }, [currentGraph, layoutResult, nodeLocatorInput])

  const handleApplyBackendUrl = useCallback(() => {
    const nextBackendUrl = normalizeBackendUrl(backendUrlInput)
    if (!nextBackendUrl) return

    localStorage.setItem('backendUrl', nextBackendUrl)
    setBackendUrl(nextBackendUrl)
  }, [backendUrlInput])

  const handleResetBackendUrl = useCallback(() => {
    const defaultBackendUrl = normalizeBackendUrl(
      import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
    )

    localStorage.removeItem('backendUrl')
    setBackendUrl(defaultBackendUrl)
    setBackendUrlInput(defaultBackendUrl)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadIndexedGraphs = async () => {
      try {
        setIsLoadingIndexedGraphs(true)
        setIndexedGraphError(null)

        const response = await fetch(`${backendUrl}/api/graphs`)
        if (!response.ok) {
          const errorText = await readBackendError(response)
          throw new Error(errorText || `Backend returned HTTP ${response.status}`)
        }

        const graphs = (await response.json()) as IndexedGraph[]
        if (cancelled) return

        setIndexedGraphs(graphs)
        setSelectedIndexedGraph(currentGraphId => {
          if (currentGraphId.startsWith(LOCAL_GRAPH_ID_PREFIX)) {
            return currentGraphId
          }

          if (graphs.some(graph => graph.id === currentGraphId)) {
            return currentGraphId
          }

          return graphs[0]?.id ?? ''
        })
      } catch (error) {
        if (cancelled) return

        const message =
          error instanceof Error ? error.message : 'Failed to load graph list'
        setIndexedGraphError(message)
        setIndexedGraphs([])
        setSelectedIndexedGraph(currentGraphId =>
          currentGraphId.startsWith(LOCAL_GRAPH_ID_PREFIX)
            ? currentGraphId
            : '',
        )
      } finally {
        if (!cancelled) {
          setIsLoadingIndexedGraphs(false)
        }
      }
    }

    loadIndexedGraphs()

    return () => {
      cancelled = true
    }
  }, [backendUrl])

  useEffect(() => {
    let cancelled = false

    const loadIndexedAnnotations = async () => {
      try {
        setIsLoadingIndexedAnnotations(true)
        setIndexedAnnotationError(null)

        const response = await fetch(`${backendUrl}/api/annotations`)
        if (!response.ok) {
          const errorText = await readBackendError(response)
          throw new Error(errorText || `Backend returned HTTP ${response.status}`)
        }

        const annotations = (await response.json()) as IndexedAnnotation[]
        if (cancelled) return

        setIndexedAnnotations(annotations)
      } catch (error) {
        if (cancelled) return

        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load annotation list'
        setIndexedAnnotationError(message)
        setIndexedAnnotations([])
      } finally {
        if (!cancelled) {
          setIsLoadingIndexedAnnotations(false)
        }
      }
    }

    loadIndexedAnnotations()

    return () => {
      cancelled = true
    }
  }, [backendUrl])

  useEffect(() => {
    let cancelled = false

    const loadRegionPaths = async () => {
      if (!selectedIndexedGraph || !selectedGraphSupportsExtraction) {
        setIsLoadingRegionPaths(false)
        setRegionPathError(null)
        setRegionPaths([])
        setSelectedRegionPathIndex(0)
        setManualRegionReference('')
        setManualRegionSequence('')
        setRegionStart('')
        setRegionEnd('')
        return
      }

      try {
        setIsLoadingRegionPaths(true)
        setRegionPathError(null)
        setRegionPaths([])
        setSelectedRegionPathIndex(0)
        setManualRegionReference('')
        setManualRegionSequence('')
        setRegionStart('')
        setRegionEnd('')

        const response = await fetch(
          `${backendUrl}/api/graphs/${encodeURIComponent(
            selectedIndexedGraph,
          )}/region-paths`,
        )
        if (!response.ok) {
          const errorText = await readBackendError(response)
          throw new Error(errorText || `Backend returned HTTP ${response.status}`)
        }

        const paths = (await response.json()) as RegionPath[]
        if (cancelled) return

        setRegionPaths(paths)
        setSelectedRegionPathIndex(0)
        const firstPath = paths[0]
        if (firstPath) {
          const defaultEnd = Math.min(firstPath.start + 100000, firstPath.end)
          setManualRegionReference(firstPath.reference)
          setManualRegionSequence(firstPath.sequence)
          setRegionStart(String(firstPath.start))
          setRegionEnd(String(defaultEnd))
        } else {
          setManualRegionReference('')
          setManualRegionSequence('')
          setRegionStart('')
          setRegionEnd('')
        }
      } catch (error) {
        if (cancelled) return

        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load coordinate tracks'
        setRegionPathError(message)
        setRegionPaths([])
        setSelectedRegionPathIndex(0)
        setManualRegionReference('')
        setManualRegionSequence('')
        setRegionStart('')
        setRegionEnd('')
      } finally {
        if (!cancelled) {
          setIsLoadingRegionPaths(false)
        }
      }
    }

    loadRegionPaths()

    return () => {
      cancelled = true
    }
  }, [backendUrl, selectedGraphSupportsExtraction, selectedIndexedGraph])

  const handleSelectedRegionPathChange = useCallback(
    (index: number) => {
      const regionPath = regionPaths[index]
      setSelectedRegionPathIndex(index)

      if (regionPath) {
        const defaultEnd = Math.min(regionPath.start + 100000, regionPath.end)
        setManualRegionReference(regionPath.reference)
        setManualRegionSequence(regionPath.sequence)
        setRegionStart(String(regionPath.start))
        setRegionEnd(String(defaultEnd))
      }
    },
    [regionPaths],
  )

  const handleBedAnnotationsChange = useCallback(
    (annotations: BedAnnotation[]) => {
      setBedAnnotations(annotations)
      setSelectedBedAnnotation(null)
    },
    [],
  )

  const handleLoadIndexedAnnotation = useCallback(
    async (annotationId: string) => {
      const selectedAnnotation = indexedAnnotations.find(
        annotation => annotation.id === annotationId,
      )

      try {
        setIsLoadingAnnotationFile(true)
        setLoadError(null)

        const response = await fetch(
          `${backendUrl}/api/annotations/${encodeURIComponent(annotationId)}`,
        )
        if (!response.ok) {
          const errorText = await readBackendError(response)
          throw new Error(errorText || `Backend returned HTTP ${response.status}`)
        }

        return {
          text: await response.text(),
          filename: selectedAnnotation?.name ?? annotationId,
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load annotation file'
        setLoadError(message)
        throw error
      } finally {
        setIsLoadingAnnotationFile(false)
      }
    },
    [backendUrl, indexedAnnotations],
  )

  const handleSelectBedAnnotation = useCallback(
    (annotation: BedAnnotation, flankBp: number) => {
      const normalizeName = (name: string) =>
        name.trim().toLowerCase().replace(/^chr/, '')
      const annotationChromosome = normalizeName(annotation.chromosome)
      const matchingRegionPathIndex = regionPaths.findIndex(regionPath => {
        const sequence = normalizeName(regionPath.sequence)
        const label = normalizeName(regionPath.label)

        return (
          sequence === annotationChromosome ||
          label === annotationChromosome ||
          label.includes(annotation.chromosome.trim().toLowerCase())
        )
      })
      const matchingRegionPath =
        matchingRegionPathIndex >= 0
          ? regionPaths[matchingRegionPathIndex]
          : undefined
      const flankedStart = Math.max(
        matchingRegionPath?.start ?? 0,
        annotation.start - flankBp,
      )
      const flankedEnd = matchingRegionPath
        ? Math.min(matchingRegionPath.end, annotation.end + flankBp)
        : annotation.end + flankBp

      setSelectedBedAnnotation(annotation)
      setRegionStart(String(flankedStart))
      setRegionEnd(String(flankedEnd))

      if (matchingRegionPathIndex >= 0) {
        setSelectedRegionPathIndex(matchingRegionPathIndex)
        setManualRegionReference(
          regionPaths[matchingRegionPathIndex]?.reference ?? '',
        )
        setManualRegionSequence(
          regionPaths[matchingRegionPathIndex]?.sequence ?? annotation.chromosome,
        )
        setLoadError(null)
      } else {
        setManualRegionReference('')
        setManualRegionSequence(annotation.chromosome)
        setLoadError(null)
      }
    },
    [regionPaths],
  )

  // Handle loading GFA from text
  const loadGFAFromText = useCallback(
    (
      text: string,
      filename: string,
      source: 'browser' | 'backend-extraction' = 'browser',
    ) => {
      try {
        setLoadingFile(true)
        setLoadError(null)

        const gfaGraph = parseGFA(text)
        const graph = convertGFAToGraph(gfaGraph, filename)

        if (source === 'browser') {
          const localGraphId = `${LOCAL_GRAPH_ID_PREFIX}${filename}`
          setLocalGraphOption({
            id: localGraphId,
            name: `${filename} (local, not indexed)`,
            description:
              'Loaded in the browser without backend-accessible index files',
          })
          setSelectedIndexedGraph(localGraphId)
        } else {
          setLocalGraphOption(null)
        }

        setCurrentGraph(graph)
        setColorScheme('uniform')
        setDrawLabels(false)
        setFileMenuOpen(false)
        setExamplesMenuOpen(false)
      } catch (error) {
        console.error('Failed to parse GFA:', error)
        setLoadError(
          error instanceof Error ? error.message : 'Failed to parse GFA file',
        )
      } finally {
        setLoadingFile(false)
      }
    },
    [],
  )

  // Handle loading from URL
  const handleLoadFromURL = useCallback(async () => {
    if (!urlInput.trim()) return

    try {
      setLoadingFile(true)
      setLoadError(null)

      const response = await fetch(urlInput)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const text = await response.text()
      const filename = urlInput.split('/').pop() || 'URL Graph'
      loadGFAFromText(text, filename)
      setUrlDialogOpen(false)
      setUrlInput('')
    } catch (error) {
      console.error('Failed to load from URL:', error)
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load from URL',
      )
    } finally {
      setLoadingFile(false)
    }
  }, [urlInput, loadGFAFromText])

  // Ask the backend to run gfaidx against a whitelisted indexed graph, then feed
  // the returned GFA text through the same parser used for uploaded files.
  const handleExtractSubgraph = useCallback(async () => {
    const startNode = subgraphStartNode.trim()
    const maxNodes = Number(extractionMaxNodes)

    if (!selectedIndexedGraph || !selectedGraphSupportsExtraction) {
      setLoadError('Choose an indexed graph before extracting a subgraph')
      return
    }

    if (!startNode) {
      setLoadError('Enter a start node ID before extracting a subgraph')
      return
    }

    if (!Number.isInteger(maxNodes) || maxNodes < 1) {
      setLoadError('Neighborhood size must be a positive integer')
      return
    }

    try {
      setIsExtractingSubgraph(true)
      setLoadError(null)

      const response = await fetch(`${backendUrl}/api/extract-subgraph`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          graph_id: selectedIndexedGraph,
          start_node: startNode,
          max_nodes: maxNodes,
        }),
      })

      if (!response.ok) {
        const errorText = await readBackendError(response)
        throw new Error(errorText || `Backend returned HTTP ${response.status}`)
      }

      const gfaText = await response.text()
      loadGFAFromText(
        gfaText,
        `${selectedIndexedGraph}_${startNode}_${maxNodes}_nodes.gfa`,
        'backend-extraction',
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to extract subgraph'
      setLoadError(message)
    } finally {
      setIsExtractingSubgraph(false)
    }
  }, [
    backendUrl,
    extractionMaxNodes,
    loadGFAFromText,
    selectedGraphSupportsExtraction,
    selectedIndexedGraph,
    subgraphStartNode,
  ])

  const handleExtractRegion = useCallback(async () => {
    const selectedRegionPath = regionPaths[selectedRegionPathIndex]
    const reference = selectedRegionPath?.reference ?? manualRegionReference.trim()
    const sequence = selectedRegionPath?.sequence ?? manualRegionSequence.trim()
    const start = Number(regionStart)
    const end = Number(regionEnd)
    const maxNodes = Number(extractionMaxNodes)

    if (!selectedIndexedGraph || !selectedGraphSupportsExtraction) {
      setLoadError('Choose an indexed graph before extracting a region')
      return
    }

    if (!sequence) {
      setLoadError('Enter a sequence before extracting a region')
      return
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0) {
      setLoadError('Region start and end must be non-negative integers')
      return
    }

    if (end <= start) {
      setLoadError('Region end must be greater than start')
      return
    }

    if (
      selectedRegionPath &&
      (start < selectedRegionPath.start || end > selectedRegionPath.end)
    ) {
      setLoadError('Region must stay within the selected coordinate track bounds')
      return
    }

    if (!Number.isInteger(maxNodes) || maxNodes < 1) {
      setLoadError('Neighborhood size must be a positive integer')
      return
    }

    try {
      setIsExtractingSubgraph(true)
      setLoadError(null)

      const response = await fetch(`${backendUrl}/api/extract-region`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          graph_id: selectedIndexedGraph,
          reference,
          sequence,
          start,
          end,
          max_nodes: maxNodes,
        }),
      })

      if (!response.ok) {
        const errorText = await readBackendError(response)
        throw new Error(errorText || `Backend returned HTTP ${response.status}`)
      }

      const gfaText = await response.text()
      const referencePrefix = reference
        ? `${reference}_`
        : ''
      loadGFAFromText(
        gfaText,
        `${selectedIndexedGraph}_${referencePrefix}${sequence}_${start}_${end}.gfa`,
        'backend-extraction',
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to extract region'
      setLoadError(message)
    } finally {
      setIsExtractingSubgraph(false)
    }
  }, [
    backendUrl,
    extractionMaxNodes,
    loadGFAFromText,
    manualRegionReference,
    manualRegionSequence,
    regionEnd,
    regionPaths,
    regionStart,
    selectedGraphSupportsExtraction,
    selectedIndexedGraph,
    selectedRegionPathIndex,
  ])

  // Handle loading from predefined URL example
  const handleLoadURLExample = useCallback(
    async (url: string, name: string) => {
      try {
        setLoadingFile(true)
        setLoadError(null)
        setFileMenuOpen(false)

        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const text = await response.text()
        loadGFAFromText(text, name)
      } catch (error) {
        console.error('Failed to load example from URL:', error)
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Failed to load example from URL',
        )
      } finally {
        setLoadingFile(false)
      }
    },
    [loadGFAFromText],
  )

  // Handle loading from local file
  const handleLoadFromFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = e => {
        const text = e.target?.result as string
        if (text) {
          loadGFAFromText(text, file.name)
        }
      }
      reader.onerror = () => {
        setLoadError('Failed to read file')
      }
      reader.readAsText(file)

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [loadGFAFromText],
  )

  useEffect(() => {
    setNodeLocatorInput('')
    setNodeLocatorError(null)
    setFocusNodeId(null)

    if (!currentGraph?.paths) {
      setSelectedPathNames([])
      setNodeColorOverrides({})
      return
    }

    const availablePathNames = new Set(currentGraph.paths.map(path => path.name))
    setSelectedPathNames(currentSelected =>
      currentSelected.filter(pathName => availablePathNames.has(pathName)),
    )
    setNodeColorOverrides({})
  }, [currentGraph])

  const handleColorPathNodes = useCallback(
    (pathName: string, color: string): number => {
      const path = currentGraph?.paths?.find(candidate => candidate.name === pathName)
      if (!path || !currentGraph) return 0

      const normalizedColor = color.startsWith('#') ? color : `#${color}`
      const graphNodeIds = new Set(currentGraph.nodes.map(node => node.id))
      const graphNodeIdsByDisplayKey = new Map<string, string[]>()

      for (const node of currentGraph.nodes) {
        const displayKey = stripNodeOrientation(node.id)
        const existingIds = graphNodeIdsByDisplayKey.get(displayKey) ?? []
        existingIds.push(node.id)
        graphNodeIdsByDisplayKey.set(displayKey, existingIds)
      }

      const matchedNodeIds = new Set<string>()
      const matchedDisplayKeys = new Set<string>()

      path.nodeIds.forEach(pathNodeId => {
        const displayKey = stripNodeOrientation(pathNodeId)
        const candidateNodeIds = [
          pathNodeId,
          displayKey,
          ...(graphNodeIdsByDisplayKey.get(displayKey) ?? []),
        ]

        candidateNodeIds.forEach(candidateNodeId => {
          if (graphNodeIds.has(candidateNodeId)) {
            matchedNodeIds.add(candidateNodeId)
            matchedDisplayKeys.add(stripNodeOrientation(candidateNodeId))
          }
        })
      })

      if (matchedNodeIds.size === 0) {
        return 0
      }

      setNodeColorOverrides(currentOverrides => {
        const nextOverrides = { ...currentOverrides }

        matchedNodeIds.forEach(nodeId => {
          nextOverrides[nodeId] = normalizedColor
        })

        return nextOverrides
      })

      return matchedDisplayKeys.size
    },
    [currentGraph],
  )

  const handleClearPathNodeColors = useCallback(() => {
    setNodeColorOverrides({})
  }, [])

  // Compute layout when graph or options change
  const computeLayout = useCallback(async () => {
    if (!worker) {
      console.warn('Worker not ready')
      return
    }

    setIsComputing(true)
    try {
      if (!currentGraph) return

      const { result, duration } = await worker.computeLayout(
        currentGraph,
        layoutOptions,
      )
      setLayoutResult(result)
      setLayoutDuration(duration)
    } catch (error) {
      console.error('Layout computation failed:', error)
    } finally {
      setIsComputing(false)
    }
  }, [worker, currentGraph, layoutOptions])

  // Use a ref to track the current request ID
  const requestIdRef = useRef(0)

  // Auto-compute on graph change (but not on layout options change)
  useEffect(() => {
    if (!worker || !currentGraph) {
      setIsComputing(false)
      return
    }

    // Increment request ID for this new computation
    const currentRequestId = ++requestIdRef.current

    const runLayout = async () => {
      setIsComputing(true)
      try {
        const { result, duration } = await worker.computeLayout(
          currentGraph,
          layoutOptions,
        )

        // Only update state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setLayoutResult(result)
          setLayoutDuration(duration)
          setIsComputing(false)
        }
      } catch (error) {
        if (currentRequestId === requestIdRef.current) {
          console.error('Layout computation failed:', error)
          setIsComputing(false)
        }
      }
    }

    runLayout()
    // Note: layoutOptions is intentionally not in deps
    // This effect only runs when the graph changes, not when changing options
    // The Redraw button is for recomputing with new options
  }, [currentGraph, worker])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!fileMenuOpen && !viewMenuOpen && !examplesMenuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        !(e.target as Element).closest('.menu-item') &&
        !(e.target as Element).closest('.dropdown-item')
      ) {
        setFileMenuOpen(false)
        setViewMenuOpen(false)
        setExamplesMenuOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [fileMenuOpen, viewMenuOpen, examplesMenuOpen])

  // Close dialog with Escape key
  useEffect(() => {
    if (!statsDialogOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatsDialogOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [statsDialogOpen])

  // Close URL dialog with Escape key
  useEffect(() => {
    if (!urlDialogOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUrlDialogOpen(false)
        setLoadError(null)
        setUrlInput('')
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [urlDialogOpen])

  // Save dark mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode))
  }, [isDarkMode])

  return (
    <div className={`app ${isDarkMode ? 'dark-mode' : ''}`}>
      <header className="app-header">
        <div className="header-top">
          <h1>BandageJS</h1>
          <div className="menu-bar">
            <div className="menu-item">
              <button
                className="menu-button"
                onClick={() => setFileMenuOpen(!fileMenuOpen)}
              >
                File
              </button>
              {fileMenuOpen && (
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setUrlDialogOpen(true)
                      setFileMenuOpen(false)
                    }}
                  >
                    <div className="dropdown-item-title">Open URL</div>
                    <div className="dropdown-item-desc">
                      Load GFA from a URL
                    </div>
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      fileInputRef.current?.click()
                      setFileMenuOpen(false)
                    }}
                  >
                    <div className="dropdown-item-title">Open Local File</div>
                    <div className="dropdown-item-desc">
                      Load GFA from your computer
                    </div>
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button
                      className="dropdown-item"
                      onClick={e => {
                        e.stopPropagation()
                        setExamplesMenuOpen(!examplesMenuOpen)
                      }}
                    >
                      <div className="dropdown-item-title">Examples →</div>
                      <div className="dropdown-item-desc">
                        Load example GFA files
                      </div>
                    </button>
                    {examplesMenuOpen && (
                      <div
                        className="dropdown-menu"
                        style={{ position: 'absolute', left: '100%', top: 0 }}
                      >
                        {urlExamples.map(example => (
                          <button
                            key={example.url}
                            className="dropdown-item"
                            onClick={() => {
                              handleLoadURLExample(example.url, example.name)
                            }}
                            disabled={loadingFile}
                          >
                            <div className="dropdown-item-title">
                              {example.name}
                            </div>
                            <div className="dropdown-item-desc">
                              {example.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="menu-item">
              <button
                className="menu-button"
                onClick={() => setViewMenuOpen(!viewMenuOpen)}
              >
                View
              </button>
              {viewMenuOpen && (
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setStatsDialogOpen(true)
                      setViewMenuOpen(false)
                    }}
                    disabled={!currentGraph}
                  >
                    Statistics
                  </button>
                  <label className="dropdown-checkbox-item">
                    <input
                      type="checkbox"
                      checked={isDarkMode}
                      onChange={e => setIsDarkMode(e.target.checked)}
                    />
                    <span>Dark Mode</span>
                  </label>
                </div>
              )}
            </div>
          </div>
          <form
            className="backend-url-control"
            onSubmit={event => {
              event.preventDefault()
              handleApplyBackendUrl()
            }}
          >
            <label htmlFor="backend-url-input">Backend</label>
            <input
              id="backend-url-input"
              type="url"
              value={backendUrlInput}
              onChange={event => setBackendUrlInput(event.currentTarget.value)}
              placeholder="http://192.168.1.10:8000"
            />
            <button type="submit">Apply</button>
            <button type="button" onClick={handleResetBackendUrl}>
              Reset
            </button>
          </form>
        </div>
      </header>

      {/* Surface file/backend load failures outside modal dialogs. Without this
          banner, extraction errors are stored but easy for users to miss. */}
      {loadError && !urlDialogOpen && (
        <div className="load-error-banner" role="alert">
          <pre>{loadError}</pre>
          <button type="button" onClick={() => setLoadError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="app-main">
        <div className="left-panel">
          <GraphExtractionControls
            graphs={graphSelectionOptions}
            selectedGraphId={selectedIndexedGraph}
            onSelectedGraphIdChange={setSelectedIndexedGraph}
            supportsExtraction={selectedGraphSupportsExtraction}
            selectedGraphIsLocal={selectedGraphIsLocal}
            graphListError={indexedGraphError}
            isLoadingGraphs={isLoadingIndexedGraphs}
            maxNodes={extractionMaxNodes}
            onMaxNodesChange={setExtractionMaxNodes}
            nodeStart={subgraphStartNode}
            onNodeStartChange={setSubgraphStartNode}
            onExtractNode={handleExtractSubgraph}
            regionPaths={regionPaths}
            selectedRegionPathIndex={selectedRegionPathIndex}
            onSelectedRegionPathIndexChange={handleSelectedRegionPathChange}
            regionPathError={regionPathError}
            isLoadingRegionPaths={isLoadingRegionPaths}
            manualRegionReference={manualRegionReference}
            onManualRegionReferenceChange={setManualRegionReference}
            manualRegionSequence={manualRegionSequence}
            onManualRegionSequenceChange={setManualRegionSequence}
            regionStart={regionStart}
            onRegionStartChange={setRegionStart}
            regionEnd={regionEnd}
            onRegionEndChange={setRegionEnd}
            onExtractRegion={handleExtractRegion}
            isExtracting={isExtractingSubgraph}
          />
          <LayoutControls
            options={layoutOptions}
            onChange={setLayoutOptions}
            onCompute={computeLayout}
            isComputing={isComputing}
            colorScheme={colorScheme}
            onColorSchemeChange={setColorScheme}
            zoom={displayZoom}
            onZoomChange={handleControlZoomChange}
            contigThickness={contigThickness}
            onContigThicknessChange={setContigThickness}
            connectorThickness={connectorThickness}
            onConnectorThicknessChange={setConnectorThickness}
            drawLabels={drawLabels}
            onDrawLabelsChange={setDrawLabels}
            labelLengthThreshold={labelLengthThreshold}
            onLabelLengthThresholdChange={setLabelLengthThreshold}
            drawPaths={drawPaths}
            onDrawPathsChange={setDrawPaths}
            hasPathsInGraph={
              !!currentGraph?.paths && currentGraph.paths.length > 0
            }
          />
        </div>

        <div className="right-panel">
          <div className="view-switch" role="tablist" aria-label="Main view">
            <button
              type="button"
              className={rightPanelView === 'graph' ? 'active' : undefined}
              onClick={() => setRightPanelView('graph')}
              role="tab"
              aria-selected={rightPanelView === 'graph'}
            >
              Graph Layout
            </button>
            <button
              type="button"
              className={
                rightPanelView === 'annotations' ? 'active' : undefined
              }
              onClick={() => setRightPanelView('annotations')}
              role="tab"
              aria-selected={rightPanelView === 'annotations'}
            >
              Annotations
            </button>
          </div>

          {rightPanelView === 'annotations' ? (
            <div className="visualization-section">
              <BedAnnotationPanel
                annotations={bedAnnotations}
                selectedAnnotation={selectedBedAnnotation}
                onAnnotationsChange={handleBedAnnotationsChange}
                onSelectAnnotation={handleSelectBedAnnotation}
                indexedAnnotations={indexedAnnotations}
                indexedAnnotationError={indexedAnnotationError}
                isLoadingIndexedAnnotations={isLoadingIndexedAnnotations}
                isLoadingAnnotationFile={isLoadingAnnotationFile}
                onLoadIndexedAnnotation={handleLoadIndexedAnnotation}
              />
            </div>
          ) : (
            <div className="visualization-section">
              <div className="graph-layout-header">
                <h3>Graph Layout</h3>
                <form
                  className="node-locator-form"
                  onSubmit={event => {
                    event.preventDefault()
                    handleLocateNode()
                  }}
                >
                  <input
                    className="control-input node-locator-input"
                    type="search"
                    value={nodeLocatorInput}
                    onChange={event => {
                      setNodeLocatorInput(event.currentTarget.value)
                      setNodeLocatorError(null)
                    }}
                    placeholder="Node ID"
                    aria-label="Node ID to locate"
                    disabled={isComputing || !layoutResult}
                  />
                  <button
                    className="node-locator-button"
                    type="submit"
                    disabled={
                      isComputing || !layoutResult || !nodeLocatorInput.trim()
                    }
                  >
                    Go to Node
                  </button>
                </form>
              </div>
              {nodeLocatorError && (
                <div className="node-locator-error" role="alert">
                  {nodeLocatorError}
                </div>
              )}
              {isComputing ? (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>Computing layout...</p>
                </div>
              ) : layoutResult ? (
                <>
                  <GraphCanvas
                    layoutResult={layoutResult}
                    graph={currentGraph}
                    width={1200}
                    height={800}
                    isDarkMode={isDarkMode}
                    colorScheme={colorScheme}
                    zoom={zoom}
                    zoomRequestId={zoomRequestId}
                    onInternalZoomChange={handleCanvasZoomChange}
                    focusNodeId={focusNodeId}
                    focusNodeRequestId={focusNodeRequestId}
                    contigThickness={contigThickness}
                    connectorThickness={connectorThickness}
                    drawLabels={drawLabels}
                    labelLengthThreshold={labelLengthThreshold}
                    drawPaths={drawPaths}
                    visiblePathIds={visiblePathNameSet}
                    nodeColorOverrides={nodeColorOverrides}
                    onUseAsStartNode={setSubgraphStartNode}
                  />
                  {/* Keep path selection close to the rendered graph so long path
                    names and search results are easier to scan. */}
                  {drawPaths &&
                    currentGraph?.paths &&
                    currentGraph.paths.length > 0 && (
                      <PathsLegend
                        paths={currentGraph.paths}
                        isDarkMode={isDarkMode}
                        selectedPathNames={visiblePathNames}
                        onTogglePath={pathName =>
                          setSelectedPathNames(currentSelected =>
                            currentSelected.includes(pathName)
                              ? currentSelected.filter(name => name !== pathName)
                              : [...currentSelected, pathName],
                          )
                        }
                        onSelectAll={() =>
                          setSelectedPathNames(
                            currentGraph.paths?.map(path => path.name) ?? [],
                          )
                        }
                        onDeselectAll={() => setSelectedPathNames([])}
                        onColorPathNodes={handleColorPathNodes}
                        onClearNodeColors={handleClearPathNodeColors}
                      />
                    )}
                </>
              ) : currentGraph ? (
                <div className="placeholder">
                  <p>Click "Redraw" to visualize the graph</p>
                </div>
              ) : (
                <div className="placeholder">
                  <p>Load a GFA file from the File menu to get started</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gfa,.gfa1,.gfa2"
        style={{ display: 'none' }}
        onChange={handleLoadFromFile}
      />

      {/* URL Dialog */}
      {urlDialogOpen && (
        <div
          className="dialog-overlay"
          onClick={() => {
            setUrlDialogOpen(false)
            setLoadError(null)
            setUrlInput('')
          }}
        >
          <div className="dialog-content" onClick={e => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Open GFA from URL</h2>
              <button
                className="dialog-close"
                onClick={() => {
                  setUrlDialogOpen(false)
                  setLoadError(null)
                  setUrlInput('')
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <div style={{ marginBottom: '15px' }}>
                <label
                  htmlFor="url-input"
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    fontWeight: 500,
                  }}
                >
                  GFA File URL:
                </label>
                <input
                  id="url-input"
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://example.com/graph.gfa"
                  disabled={loadingFile}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !loadingFile) {
                      handleLoadFromURL()
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '14px',
                    border: isDarkMode ? '1px solid #444' : '1px solid #ddd',
                    borderRadius: '4px',
                    background: isDarkMode ? '#1a1a1a' : 'white',
                    color: isDarkMode ? '#e0e0e0' : '#333',
                  }}
                />
              </div>
              {loadError && (
                <div
                  style={{
                    padding: '10px',
                    marginBottom: '15px',
                    background: '#fee',
                    border: '1px solid #fcc',
                    borderRadius: '4px',
                    color: '#c33',
                    fontSize: '13px',
                  }}
                >
                  {loadError}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  onClick={() => {
                    setUrlDialogOpen(false)
                    setLoadError(null)
                    setUrlInput('')
                  }}
                  disabled={loadingFile}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    border: isDarkMode ? '1px solid #444' : '1px solid #ddd',
                    borderRadius: '4px',
                    background: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                    color: isDarkMode ? '#e0e0e0' : '#333',
                    cursor: loadingFile ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleLoadFromURL}
                  disabled={loadingFile || !urlInput.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    border: 'none',
                    borderRadius: '4px',
                    background:
                      loadingFile || !urlInput.trim() ? '#ccc' : '#0066cc',
                    color: 'white',
                    cursor:
                      loadingFile || !urlInput.trim()
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {loadingFile ? 'Loading...' : 'Load'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Dialog */}
      {statsDialogOpen && currentGraph && (
        <div
          className="dialog-overlay"
          onClick={() => setStatsDialogOpen(false)}
        >
          <div className="dialog-content" onClick={e => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Graph Statistics</h2>
              <button
                className="dialog-close"
                onClick={() => setStatsDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <StatsPanel
                graph={currentGraph}
                layoutDuration={layoutDuration}
              />
              <div className="stats-section">
                <h3>Length Distribution</h3>
                <LengthDistribution
                  graph={currentGraph}
                  width={700}
                  height={200}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
