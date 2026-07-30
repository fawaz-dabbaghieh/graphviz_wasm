import { useState } from 'react'
import type { IndexedGraph, RegionPath } from '../types'

interface GraphExtractionControlsProps {
  graphs: IndexedGraph[]
  selectedGraphId: string
  onSelectedGraphIdChange: (graphId: string) => void
  supportsExtraction: boolean
  selectedGraphIsLocal: boolean
  graphListError: string | null
  isLoadingGraphs: boolean
  maxNodes: string
  onMaxNodesChange: (value: string) => void
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
  maxNodes,
  onMaxNodesChange,
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
  onExtractRegion,
  isExtracting,
}: GraphExtractionControlsProps) {
  const [graphPanelExpanded, setGraphPanelExpanded] = useState(true)
  const selectedRegionPath = regionPaths[selectedRegionPathIndex]
  const controlsDisabled =
    isExtracting ||
    isLoadingGraphs ||
    graphs.length === 0 ||
    !supportsExtraction
  const useManualRegion = supportsExtraction && regionPaths.length === 0

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
            <div className="control-group">
              <label htmlFor="indexed-graph-select">
                <strong>Available Graph:</strong>
              </label>
              <select
                id="indexed-graph-select"
                className="control-select"
                value={selectedGraphId}
                onChange={event =>
                  onSelectedGraphIdChange(event.currentTarget.value)
                }
                disabled={isLoadingGraphs || isExtracting || graphs.length === 0}
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
              <label htmlFor="extraction-max-nodes">
                <strong>Max Nodes:</strong>
              </label>
              <input
                id="extraction-max-nodes"
                className="control-input"
                type="number"
                min="1"
                step="1"
                value={maxNodes}
                onChange={event => onMaxNodesChange(event.currentTarget.value)}
                disabled={controlsDisabled}
              />
              <div className="control-hint">
                Applies to both node and coordinate extraction. No testing cap is
                enforced here.
              </div>
            </div>

            <form
              className="graph-control-form"
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

              <button
                className="compute-button"
                type="submit"
                disabled={controlsDisabled}
              >
                {isExtracting ? 'Extracting...' : 'Extract Node Subgraph'}
              </button>
            </form>

            <form
              className="graph-control-form"
              onSubmit={event => {
                event.preventDefault()
                onExtractRegion()
              }}
            >
              <h4>Coordinate Region</h4>
              <div className="control-group">
                <label htmlFor="region-path-select">Coordinate Track</label>
                <select
                  id="region-path-select"
                  className="control-select"
                  value={String(selectedRegionPathIndex)}
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
                  ) : (
                    regionPaths.map((regionPath, index) => (
                      <option key={`${regionPath.label}-${index}`} value={index}>
                        {regionPath.label}
                      </option>
                    ))
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
                {isExtracting ? 'Extracting...' : 'Extract Region'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
