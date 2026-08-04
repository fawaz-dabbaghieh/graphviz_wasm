import { useEffect, useMemo, useState } from 'react'
import type { IndexedGraph, RegionPath } from '../types'

interface GraphExtractionControlsProps {
  graphs: IndexedGraph[]
  selectedGraphId: string
  onSelectedGraphIdChange: (graphId: string) => void
  supportsExtraction: boolean
  selectedGraphIsLocal: boolean
  graphListError: string | null
  isLoadingGraphs: boolean
  nodeMaxNodes: string
  onNodeMaxNodesChange: (value: string) => void
  regionMaxNodes: string
  onRegionMaxNodesChange: (value: string) => void
  withCoords: boolean
  onWithCoordsChange: (enabled: boolean) => void
  nodeStart: string
  onNodeStartChange: (value: string) => void
  onExtractNode: () => void
  regionPaths: RegionPath[]
  selectedRegionPathIndex: number
  onSelectedRegionPathIndexChange: (index: number) => void
  regionPathError: string | null
  isLoadingRegionPaths: boolean
  manualRegionReference: string
  onManualRegionReferenceChange: (value: string) => void
  manualRegionSequence: string
  onManualRegionSequenceChange: (value: string) => void
  regionStart: string
  onRegionStartChange: (value: string) => void
  regionEnd: string
  onRegionEndChange: (value: string) => void
  allHaplotypes: boolean
  onAllHaplotypesChange: (enabled: boolean) => void
  onExtractRegion: () => void
  isExtracting: boolean
}

export function GraphExtractionControls({
  graphs,
  selectedGraphId,
  onSelectedGraphIdChange,
  supportsExtraction,
  selectedGraphIsLocal,
  graphListError,
  isLoadingGraphs,
  nodeMaxNodes,
  onNodeMaxNodesChange,
  regionMaxNodes,
  onRegionMaxNodesChange,
  withCoords,
  onWithCoordsChange,
  nodeStart,
  onNodeStartChange,
  onExtractNode,
  regionPaths,
  selectedRegionPathIndex,
  onSelectedRegionPathIndexChange,
  regionPathError,
  isLoadingRegionPaths,
  manualRegionReference,
  onManualRegionReferenceChange,
  manualRegionSequence,
  onManualRegionSequenceChange,
  regionStart,
  onRegionStartChange,
  regionEnd,
  onRegionEndChange,
  allHaplotypes,
  onAllHaplotypesChange,
  onExtractRegion,
  isExtracting,
}: GraphExtractionControlsProps) {
  const [graphPanelExpanded, setGraphPanelExpanded] = useState(true)
  const [coordinateTrackQuery, setCoordinateTrackQuery] = useState('')
  const selectedRegionPath = regionPaths[selectedRegionPathIndex]
  const controlsDisabled =
    isExtracting ||
    isLoadingGraphs ||
    graphs.length === 0 ||
    !supportsExtraction
  const useManualRegion = supportsExtraction && regionPaths.length === 0
  const filteredRegionPaths = useMemo(() => {
    const query = coordinateTrackQuery.trim().toLocaleLowerCase()

    // Retain original indices because the parent stores the selection by index.
    return regionPaths
      .map((regionPath, index) => ({ regionPath, index }))
      .filter(({ regionPath }) => {
        if (!query) {
          return true
        }

        return [
          regionPath.label,
          regionPath.source,
          regionPath.reference,
          regionPath.haplotype,
          regionPath.sequence,
        ].some(value => value.toLocaleLowerCase().includes(query))
      })
  }, [coordinateTrackQuery, regionPaths])
  const selectedRegionPathIsVisible = filteredRegionPaths.some(
    ({ index }) => index === selectedRegionPathIndex,
  )
  const regionPathSelectValue = selectedRegionPathIsVisible
    ? String(selectedRegionPathIndex)
    : ''

  useEffect(() => {
    setCoordinateTrackQuery('')
  }, [selectedGraphId])

  return (
    <div className="layout-controls graph-extraction-controls">
      <div className="advanced-settings">
        <button
          className="advanced-toggle"
          onClick={() => setGraphPanelExpanded(!graphPanelExpanded)}
          type="button"
        >
          <span className={`arrow ${graphPanelExpanded ? 'expanded' : ''}`}>
            ▶
          </span>
          Graph Selection
        </button>

        {graphPanelExpanded && (
          <div className="advanced-content">
            <section className="graph-selection-section">
              <h4>Graph Options</h4>
              <div className="control-group">
                <label htmlFor="indexed-graph-select">Available Graph</label>
                <select
                  id="indexed-graph-select"
                  className="control-select"
                  value={selectedGraphId}
                  onChange={event =>
                    onSelectedGraphIdChange(event.currentTarget.value)
                  }
                  disabled={
                    isLoadingGraphs || isExtracting || graphs.length === 0
                  }
                >
                  {graphs.length === 0 ? (
                    <option value="">
                      {isLoadingGraphs ? 'Loading graphs...' : 'No graphs found'}
                    </option>
                  ) : (
                    graphs.map(graph => (
                      <option key={graph.id} value={graph.id}>
                        {graph.name}
                      </option>
                    ))
                  )}
                </select>
                {selectedGraphIsLocal ? (
                  <div className="control-hint">
                    This graph is loaded only in the browser. Node and coordinate
                    extraction require a graph registered with the backend.
                  </div>
                ) : graphListError ? (
                  <div className="control-error">{graphListError}</div>
                ) : (
                  <div className="control-hint">
                    Graphs are loaded from the backend registry.
                  </div>
                )}
              </div>

              <div className="control-group">
                <label className="checkbox-control-label">
                  <input
                    type="checkbox"
                    checked={withCoords}
                    onChange={event =>
                      onWithCoordsChange(event.currentTarget.checked)
                    }
                    disabled={controlsDisabled}
                  />
                  <strong>With Coordinates</strong>
                </label>
                <div className="control-hint">
                  Calculate coordinate-bearing path and walk records for both
                  extraction methods.
                </div>
              </div>
            </section>

            <form
              className="graph-control-form graph-selection-section"
              onSubmit={event => {
                event.preventDefault()
                onExtractNode()
              }}
            >
              <h4>Node Neighborhood</h4>
              <div className="control-group">
                <label htmlFor="subgraph-start-node">Start Node ID</label>
                <input
                  id="subgraph-start-node"
                  className="control-input"
                  type="text"
                  value={nodeStart}
                  onChange={event => onNodeStartChange(event.currentTarget.value)}
                  disabled={controlsDisabled}
                />
              </div>

              <div className="control-group">
                <label htmlFor="node-max-nodes">Max Nodes</label>
                <input
                  id="node-max-nodes"
                  className="control-input"
                  type="number"
                  min="1"
                  step="1"
                  value={nodeMaxNodes}
                  onChange={event =>
                    onNodeMaxNodesChange(event.currentTarget.value)
                  }
                  disabled={controlsDisabled}
                />
                <div className="control-hint">
                  Maximum neighborhood size. No testing cap is enforced here.
                </div>
              </div>

              <button
                className="compute-button"
                type="submit"
                disabled={controlsDisabled}
              >
                {isExtracting ? 'Extracting...' : 'Extract Node Subgraph'}
              </button>
            </form>

            <form
              className="graph-control-form graph-selection-section"
              onSubmit={event => {
                event.preventDefault()
                onExtractRegion()
              }}
            >
              <h4>Coordinate Region</h4>
              <div className="control-group">
                <label>Extraction Method</label>
                <div
                  className="extraction-mode-options"
                  role="radiogroup"
                  aria-label="Coordinate region extraction method"
                >
                  <label>
                    <input
                      type="radio"
                      name="coordinate-region-mode"
                      checked={allHaplotypes}
                      onChange={() => onAllHaplotypesChange(true)}
                      disabled={controlsDisabled}
                    />
                    <span>All Haplotypes</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="coordinate-region-mode"
                      checked={!allHaplotypes}
                      onChange={() => onAllHaplotypesChange(false)}
                      disabled={controlsDisabled}
                    />
                    <span>BFS</span>
                  </label>
                </div>
                <div className="control-hint">
                  {allHaplotypes
                    ? 'Extract exact anchor-supported path and walk spans across all haplotypes.'
                    : 'Extract a bounded breadth-first neighborhood around the requested region.'}
                </div>
              </div>
              {!allHaplotypes && (
                <div className="control-group">
                  <label htmlFor="region-max-nodes">Max Nodes</label>
                  <input
                    id="region-max-nodes"
                    className="control-input"
                    type="number"
                    min="1"
                    step="1"
                    value={regionMaxNodes}
                    onChange={event =>
                      onRegionMaxNodesChange(event.currentTarget.value)
                    }
                    disabled={controlsDisabled}
                  />
                  <div className="control-hint">
                    Maximum number of nodes returned by BFS.
                  </div>
                </div>
              )}
              <div className="control-group">
                <label htmlFor="region-path-search">
                  Search Coordinate Tracks
                </label>
                <input
                  id="region-path-search"
                  className="control-input"
                  type="search"
                  value={coordinateTrackQuery}
                  onChange={event =>
                    setCoordinateTrackQuery(event.currentTarget.value)
                  }
                  onKeyDown={event => {
                    if (event.key !== 'Enter') {
                      return
                    }

                    event.preventDefault()
                    const firstMatch = filteredRegionPaths[0]
                    if (firstMatch) {
                      onSelectedRegionPathIndexChange(firstMatch.index)
                    }
                  }}
                  placeholder="Type a path, sample, or sequence name"
                  disabled={
                    controlsDisabled ||
                    isLoadingRegionPaths ||
                    regionPaths.length === 0
                  }
                />
                {regionPaths.length > 0 && (
                  <div className="control-hint">
                    {filteredRegionPaths.length.toLocaleString()} of{' '}
                    {regionPaths.length.toLocaleString()} tracks
                  </div>
                )}
              </div>
              <div className="control-group">
                <label htmlFor="region-path-select">Coordinate Track</label>
                <select
                  id="region-path-select"
                  className="control-select"
                  value={regionPathSelectValue}
                  onChange={event =>
                    onSelectedRegionPathIndexChange(
                      Number(event.currentTarget.value),
                    )
                  }
                  disabled={
                    controlsDisabled ||
                    isLoadingRegionPaths ||
                    regionPaths.length === 0
                  }
                >
                  {regionPaths.length === 0 ? (
                    <option value="0">
                      {isLoadingRegionPaths
                        ? 'Loading coordinate tracks...'
                        : 'No coordinate tracks found'}
                    </option>
                  ) : filteredRegionPaths.length === 0 ? (
                    <option value="">No matching coordinate tracks</option>
                  ) : (
                    <>
                      {!selectedRegionPathIsVisible && (
                        <option value="">Choose a matching track</option>
                      )}
                      {filteredRegionPaths.map(({ regionPath, index }) => (
                        <option
                          key={`${regionPath.label}-${index}`}
                          value={index}
                        >
                          {regionPath.label}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {selectedGraphIsLocal ? (
                  <div className="control-hint">
                    Coordinate tracks are unavailable for local browser uploads.
                  </div>
                ) : regionPathError ? (
                  <div className="control-error">{regionPathError}</div>
                ) : selectedRegionPath ? (
                  <div className="control-hint">
                    Available interval: {selectedRegionPath.start.toLocaleString()}
                    {' - '}
                    {selectedRegionPath.end.toLocaleString()}
                  </div>
                ) : (
                  <div className="control-hint">
                    No coordinate index found. Enter the sequence manually below.
                  </div>
                )}
              </div>

              {useManualRegion && (
                <>
                  <div className="control-group">
                    <label htmlFor="manual-region-sequence">Sequence</label>
                    <input
                      id="manual-region-sequence"
                      className="control-input"
                      type="text"
                      value={manualRegionSequence}
                      onChange={event =>
                        onManualRegionSequenceChange(event.currentTarget.value)
                      }
                      placeholder="chr22"
                      disabled={controlsDisabled || isLoadingRegionPaths}
                    />
                  </div>

                  <div className="control-group">
                    <label htmlFor="manual-region-reference">
                      Reference Sample
                    </label>
                    <input
                      id="manual-region-reference"
                      className="control-input"
                      type="text"
                      value={manualRegionReference}
                      onChange={event =>
                        onManualRegionReferenceChange(event.currentTarget.value)
                      }
                      placeholder="optional"
                      disabled={controlsDisabled || isLoadingRegionPaths}
                    />
                  </div>
                </>
              )}

              <div className="control-row">
                <div className="control-group">
                  <label htmlFor="region-start">Start</label>
                  <input
                    id="region-start"
                    className="control-input"
                    type="number"
                    min="0"
                    step="1"
                    value={regionStart}
                    onChange={event =>
                      onRegionStartChange(event.currentTarget.value)
                    }
                    disabled={
                      controlsDisabled || isLoadingRegionPaths
                    }
                  />
                </div>

                <div className="control-group">
                  <label htmlFor="region-end">End</label>
                  <input
                    id="region-end"
                    className="control-input"
                    type="number"
                    min="1"
                    step="1"
                    value={regionEnd}
                    onChange={event =>
                      onRegionEndChange(event.currentTarget.value)
                    }
                    disabled={
                      controlsDisabled || isLoadingRegionPaths
                    }
                  />
                </div>
              </div>

              <button
                className="compute-button"
                type="submit"
                disabled={
                  controlsDisabled ||
                  isLoadingRegionPaths ||
                  (useManualRegion && !manualRegionSequence.trim())
                }
              >
                {isExtracting
                  ? 'Extracting...'
                  : allHaplotypes
                    ? 'Extract All Haplotypes'
                    : 'Extract Region'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
