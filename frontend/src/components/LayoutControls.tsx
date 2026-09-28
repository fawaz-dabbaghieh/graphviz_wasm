import { useMemo, useState } from 'react'
import type {
  LayoutOptions,
  ColorScheme,
  GraphPath,
} from '../types'
import { pathHasRepeatedSegments } from '../utils/displayGraph'
import { HelpIcon } from './HelpIcon'

interface LayoutControlsProps {
  options: LayoutOptions
  onChange: (options: LayoutOptions) => void
  onCompute: () => void
  isComputing: boolean
  colorScheme: ColorScheme
  onColorSchemeChange: (scheme: ColorScheme) => void
  zoom: number
  onZoomChange: (zoom: number) => void
  contigThickness: number
  onContigThicknessChange: (thickness: number) => void
  connectorThickness: number
  onConnectorThicknessChange: (thickness: number) => void
  drawLabels: boolean
  onDrawLabelsChange: (draw: boolean) => void
  labelLengthThreshold: number
  onLabelLengthThresholdChange: (threshold: number) => void
  drawPaths: boolean
  onDrawPathsChange: (draw: boolean) => void
  hasPathsInGraph: boolean
  paths: GraphPath[]
  // Set when a coordinate-region query's own path couldn't become the
  // linear layout backbone (it repeats a segment), so the user sees why they
  // got the normal layout instead of what they asked for.
  fallbackWarning: string | null
  hasLayoutResult: boolean
  isLargeGraph: boolean
}

export function LayoutControls({
  options,
  onChange,
  onCompute,
  isComputing,
  colorScheme,
  onColorSchemeChange,
  contigThickness,
  onContigThicknessChange,
  connectorThickness,
  onConnectorThicknessChange,
  drawLabels,
  onDrawLabelsChange,
  labelLengthThreshold,
  onLabelLengthThresholdChange,
  drawPaths,
  onDrawPathsChange,
  hasPathsInGraph,
  paths,
  fallbackWarning,
  hasLayoutResult,
  isLargeGraph,
}: LayoutControlsProps) {
  // The zoom slider is temporarily hidden (broken sync with canvas wheel-zoom);
  // `zoom`/`onZoomChange` stay in the prop contract for when it's re-enabled.
  const [otherSettingsExpanded, setOtherSettingsExpanded] = useState(false)
  const [referencePathQuery, setReferencePathQuery] = useState('')
  const repeatedReferencePathNames = useMemo(() => {
    const repeatedPaths = new Set<string>()

    for (const path of paths) {
      if (pathHasRepeatedSegments(path.nodeIds))
        repeatedPaths.add(path.name)
    }

    return repeatedPaths
  }, [paths])
  // A pangenome graph can have hundreds of haplotype paths, at which point
  // scrolling a plain <select> to find one by eye stops being practical.
  const filteredReferencePaths = useMemo(() => {
    const query = referencePathQuery.trim().toLocaleLowerCase()
    if (!query) return paths
    return paths.filter(path => path.name.toLocaleLowerCase().includes(query))
  }, [paths, referencePathQuery])
  const selectedReferencePathIsVisible =
    options.referencePathName === '' ||
    filteredReferencePaths.some(path => path.name === options.referencePathName)

  return (
    <div className="layout-controls">
      <div className="display-section">
        <h4>Display</h4>

        {fallbackWarning && (
          <div className="control-warning">{fallbackWarning}</div>
        )}

        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={options.linearLayout}
              onChange={e =>
                onChange({ ...options, linearLayout: e.target.checked })
              }
              disabled={isComputing}
            />{' '}
            Linear Layout
          </label>
          <div className="control-hint">
            Use node-ID ordering, or straighten a selected reference path
            after force-directed layout.
          </div>
        </div>

        {options.linearLayout && hasPathsInGraph && (
          <>
            {paths.length > 8 && (
              <div className="control-group">
                <label htmlFor="reference-path-search">
                  Search Reference Paths
                </label>
                <input
                  id="reference-path-search"
                  className="control-input"
                  type="search"
                  value={referencePathQuery}
                  onChange={event =>
                    setReferencePathQuery(event.currentTarget.value)
                  }
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    const firstMatch = filteredReferencePaths.find(
                      path => !repeatedReferencePathNames.has(path.name),
                    )
                    if (firstMatch) {
                      onChange({
                        ...options,
                        referencePathName: firstMatch.name,
                      })
                    }
                  }}
                  placeholder="Type a path or sample name"
                  disabled={isComputing}
                />
                <div className="control-hint">
                  {filteredReferencePaths.length.toLocaleString()} of{' '}
                  {paths.length.toLocaleString()} paths
                </div>
              </div>
            )}
            <div className="control-group">
              <label htmlFor="reference-path-select">
                <strong>Reference Path:</strong>
              </label>
              <select
                id="reference-path-select"
                className="control-select"
                value={
                  selectedReferencePathIsVisible ? options.referencePathName : ''
                }
                onChange={event =>
                  onChange({
                    ...options,
                    referencePathName: event.currentTarget.value,
                  })
                }
                disabled={isComputing}
              >
                <option value="">Node ID order</option>
                {!selectedReferencePathIsVisible && (
                  <option value={options.referencePathName} disabled>
                    {options.referencePathName} (hidden by search)
                  </option>
                )}
                {filteredReferencePaths.map(path => {
                  const hasRepeatedSegments =
                    repeatedReferencePathNames.has(path.name)
                  return (
                    <option
                      key={path.name}
                      value={path.name}
                      disabled={hasRepeatedSegments}
                    >
                      {path.name}
                      {hasRepeatedSegments
                        ? ' (repeated segments - unavailable)'
                        : ''}
                    </option>
                  )
                })}
              </select>
              <div className="control-hint">
                Keep the selected path horizontal in traversal order.
              </div>
              {repeatedReferencePathNames.size > 0 && (
                <div className="control-error">
                  {repeatedReferencePathNames.size} path
                  {repeatedReferencePathNames.size === 1 ? '' : 's'} cannot be
                  used as a reference because they repeat a segment.
                </div>
              )}
            </div>
          </>
        )}

        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={drawLabels}
              onChange={e => onDrawLabelsChange(e.target.checked)}
              disabled={isComputing}
            />{' '}
            Draw Labels
          </label>
          <div className="control-hint">Show contig names on the graph</div>
        </div>

        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={drawPaths}
              onChange={e => onDrawPathsChange(e.target.checked)}
              disabled={isComputing || !hasPathsInGraph}
            />{' '}
            List Paths{!hasPathsInGraph && ' (no paths present)'}
          </label>
          <div className="control-hint">
            Show the path list. Select paths there to draw overlays.
          </div>
        </div>
      </div>

      <div className="advanced-settings">
        <button
          className="advanced-toggle"
          onClick={() => setOtherSettingsExpanded(!otherSettingsExpanded)}
        >
          <span className={`arrow ${otherSettingsExpanded ? 'expanded' : ''}`}>
            ▶
          </span>
          Other Settings
        </button>

        {otherSettingsExpanded && (
          <div className="advanced-content">
            <div className="control-group">
              <label>
                <strong>Quality Level:</strong>
                <span className="control-value">{options.quality}</span>
              </label>
              <input
                type="range"
                min="0"
                max="4"
                value={options.quality}
                onChange={e =>
                  onChange({ ...options, quality: parseInt(e.target.value) })
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Higher = better layout, slower computation
              </div>
            </div>

            {options.linearLayout && options.referencePathName && (
              <div className="control-group">
                <label>
                  <strong>Path Straightening Rounds:</strong>
                  <span className="control-value">
                    {options.referencePathRelaxRounds}
                  </span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={options.referencePathRelaxRounds}
                  onChange={e =>
                    onChange({
                      ...options,
                      referencePathRelaxRounds: parseInt(e.target.value),
                    })
                  }
                  disabled={isComputing}
                />
                <div className="control-hint">
                  How many times the layout re-settles around the
                  straightened reference path. Higher = straighter
                  neighborhood, slower computation.
                </div>
              </div>
            )}

            <div className="control-group">
              <label>
                <strong>Edge Length:</strong>
                <span className="control-value">
                  {options.edgeLength.toFixed(0)}
                </span>
              </label>
              <input
                type="range"
                min="0.5"
                max="20"
                step="0.5"
                value={options.edgeLength}
                onChange={e =>
                  onChange({
                    ...options,
                    edgeLength: parseFloat(e.target.value),
                  })
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Distance between connected contigs (scales with node length)
              </div>
            </div>

            <div className="control-group">
              <label>
                <strong>Component Separation:</strong>
                <span className="control-value">
                  {options.componentSeparation.toFixed(1)}
                </span>
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={options.componentSeparation}
                onChange={e =>
                  onChange({
                    ...options,
                    componentSeparation: parseFloat(e.target.value),
                  })
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Space between disconnected components
              </div>
            </div>

            <div className="control-group">
              <label>
                <strong>Node Length Per Megabase:</strong>
                <span className="control-value">
                  {options.nodeLengthPerMegabase.toFixed(0)}
                </span>
              </label>
              <input
                type="range"
                min="500"
                max="5000"
                step="500"
                value={options.nodeLengthPerMegabase}
                onChange={e =>
                  onChange({
                    ...options,
                    nodeLengthPerMegabase: parseFloat(e.target.value),
                  })
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Controls visual scale based on sequence length
              </div>
            </div>

            <div className="control-group">
              <label>
                <strong>Color Scheme:</strong>
                <HelpIcon
                  text={
                    'Uniform: one color for every contig. ' +
                    'Rainbow: a distinct color per contig. ' +
                    'Color by Depth: color scaled by sequencing depth. ' +
                    'Grey: greyscale, useful when relying on path colors instead.'
                  }
                />
              </label>
              <select
                value={colorScheme}
                onChange={e =>
                  onColorSchemeChange(e.target.value as ColorScheme)
                }
                disabled={isComputing}
                className="color-scheme-select"
              >
                <option value="uniform">Uniform Color</option>
                <option value="random">Rainbow</option>
                <option value="depth">Color by Depth</option>
                <option value="grey">Grey</option>
              </select>
            </div>

            <div className="control-group">
              <label>
                <strong>Contig Thickness:</strong>
                <span className="control-value">
                  {contigThickness.toFixed(1)}px
                </span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={contigThickness}
                onChange={e =>
                  onContigThicknessChange(parseFloat(e.target.value))
                }
                disabled={isComputing}
              />
              <div className="control-hint">Thickness of contig lines</div>
            </div>

            <div className="control-group">
              <label>
                <strong>Connector Thickness:</strong>
                <span className="control-value">
                  {connectorThickness.toFixed(1)}px
                </span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={connectorThickness}
                onChange={e =>
                  onConnectorThicknessChange(parseFloat(e.target.value))
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Thickness of connector lines (edges)
              </div>
            </div>

            <div className="control-group">
              <label>
                <strong>Label Length Threshold:</strong>
                <span className="control-value">
                  {labelLengthThreshold.toLocaleString()} bp
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="100000"
                step="1000"
                value={labelLengthThreshold}
                onChange={e =>
                  onLabelLengthThresholdChange(parseFloat(e.target.value))
                }
                disabled={isComputing}
              />
              <div className="control-hint">
                Only show labels on contigs longer than this
              </div>
            </div>
          </div>
        )}
      </div>

      {isLargeGraph && (
        <div className="control-warning">
          Large graph - layout may be slow or use a lot of memory.
        </div>
      )}

      <button
        className="compute-button"
        onClick={onCompute}
        disabled={isComputing}
      >
        {isComputing
          ? hasLayoutResult
            ? 'Redrawing...'
            : 'Computing Layout...'
          : hasLayoutResult
            ? 'Redraw'
            : 'Compute Layout'}
      </button>
    </div>
  )
}
