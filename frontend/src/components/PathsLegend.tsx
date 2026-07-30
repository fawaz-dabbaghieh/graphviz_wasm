import { useMemo, useState } from 'react'
import type { GraphPath } from '../types'

interface PathsLegendProps {
  paths: GraphPath[]
  isDarkMode?: boolean
  selectedPathNames: string[]
  onTogglePath: (pathName: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onColorPathNodes: (pathName: string, color: string) => number
  onClearNodeColors: () => void
}

interface ColorFeedback {
  pathName: string
  message: string
  isError?: boolean
}

function normalizeHexColorInput(color: string): string | null {
  const trimmedColor = color.trim()
  const normalizedColor = trimmedColor.startsWith('#')
    ? trimmedColor
    : `#${trimmedColor}`

  return /^#[0-9a-fA-F]{6}$/.test(normalizedColor)
    ? normalizedColor
    : null
}

function formatWalkCoordinate(coordinate: string): string {
  const numericCoordinate = Number(coordinate)
  return coordinate !== '' && Number.isSafeInteger(numericCoordinate)
    ? numericCoordinate.toLocaleString()
    : coordinate || 'unknown'
}

export function PathsLegend({
  paths,
  isDarkMode = true,
  selectedPathNames,
  onTogglePath,
  onSelectAll,
  onDeselectAll,
  onColorPathNodes,
  onClearNodeColors,
}: PathsLegendProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeColorPathName, setActiveColorPathName] = useState<string | null>(
    null,
  )
  const [nodeColorInput, setNodeColorInput] = useState('#e53935')
  const [colorFeedback, setColorFeedback] = useState<ColorFeedback | null>(null)
  const colorPresets = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa']

  // Generate colors matching GraphCanvas
  const hueStep = 360 / paths.length
  const pathColors = paths.map((_, idx) => {
    const hue = idx * hueStep
    return `hsl(${hue}, 70%, 50%)`
  })
  const selectedPathNameSet = new Set(selectedPathNames)
  // Search narrows the list in the panel only; selection state still lives in
  // App so filtering the list never clears an existing selection.
  const filteredPaths = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return paths
    }

    return paths.filter(path => {
      const searchableValues = [
        path.name,
        path.walk?.sampleName,
        path.walk?.haplotypeIndex,
        path.walk?.sequenceName,
        path.walk?.sequenceStart,
        path.walk?.sequenceEnd,
        ...(path.walk?.tags ?? []),
      ]

      return searchableValues.some(value =>
        value?.toLowerCase().includes(normalizedQuery),
      )
    })
  }, [paths, searchQuery])

  const applyNodeColor = (pathName: string, color: string) => {
    const normalizedColor = normalizeHexColorInput(color)
    if (!normalizedColor) {
      setColorFeedback({
        pathName,
        message: 'Enter a 6-digit hex color.',
        isError: true,
      })
      return
    }

    setNodeColorInput(normalizedColor)
    const coloredNodeCount = onColorPathNodes(pathName, normalizedColor)
    setColorFeedback({
      pathName,
      message:
        coloredNodeCount === 0
          ? 'No matching displayed nodes found.'
          : `Colored ${coloredNodeCount.toLocaleString()} displayed node${coloredNodeCount === 1 ? '' : 's'}.`,
      isError: coloredNodeCount === 0,
    })
  }

  return (
    <div
      style={{
        background: isDarkMode ? '#2a2a2a' : '#f5f5f5',
        border: isDarkMode ? '1px solid #444' : '1px solid #ddd',
        borderRadius: '8px',
        padding: '12px',
        marginTop: '10px',
      }}
    >
      <div
        style={{
          fontSize: '13px',
          fontWeight: 'bold',
          marginBottom: '8px',
          color: isDarkMode ? '#e0e0e0' : '#333',
        }}
      >
        Paths
      </div>
      {/* Large path sets are easier to work with when the panel can be filtered
          independently of the graph rendering state. */}
      <input
        type="search"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search paths..."
        style={{
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: '10px',
          padding: '8px 10px',
          borderRadius: '6px',
          border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
          background: isDarkMode ? '#1f1f1f' : '#fff',
          color: isDarkMode ? '#e0e0e0' : '#333',
          fontSize: '13px',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '10px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onSelectAll}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
            background: isDarkMode ? '#3a3a3a' : '#fff',
            color: isDarkMode ? '#e0e0e0' : '#333',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={onDeselectAll}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
            background: isDarkMode ? '#3a3a3a' : '#fff',
            color: isDarkMode ? '#e0e0e0' : '#333',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Deselect all
        </button>
        <button
          type="button"
          onClick={() => {
            onClearNodeColors()
            setColorFeedback(null)
          }}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
            background: isDarkMode ? '#3a3a3a' : '#fff',
            color: isDarkMode ? '#e0e0e0' : '#333',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Clear node colors
        </button>
        <span
          style={{
            color: isDarkMode ? '#aaa' : '#666',
            fontSize: '12px',
            marginLeft: 'auto',
          }}
        >
          {selectedPathNames.length} / {paths.length} selected
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '320px',
          overflowY: 'auto',
          paddingRight: '4px',
        }}
      >
        {filteredPaths.map(path => {
          // Keep each path's color stable even when the visible list is filtered
          // or reordered by search.
          const idx = paths.findIndex(candidate => candidate.name === path.name)

          return (
          <div
            key={path.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '12px',
              opacity: selectedPathNameSet.has(path.name) ? 1 : 0.8,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selectedPathNameSet.has(path.name)}
                onChange={() => onTogglePath(path.name)}
              />
              <div
                style={{
                  width: '30px',
                  height: '3px',
                  backgroundColor: pathColors[idx],
                  borderRadius: '2px',
                  flexShrink: 0,
                }}
              />
              <span
                title={path.name}
                style={{
                  color: isDarkMode ? '#ccc' : '#555',
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {path.name}
              </span>
              <span
                style={{
                  color: isDarkMode ? '#888' : '#999',
                  fontSize: '11px',
                  marginLeft: 'auto',
                  flexShrink: 0,
                }}
              >
                {path.nodeIds.length} nodes
              </span>
              <button
                type="button"
                onClick={event => {
                  event.preventDefault()
                  setActiveColorPathName(
                    activeColorPathName === path.name ? null : path.name,
                  )
                }}
                title="Color nodes in this path"
                style={{
                  padding: '3px 7px',
                  borderRadius: '4px',
                  border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
                  background: isDarkMode ? '#3a3a3a' : '#fff',
                  color: isDarkMode ? '#e0e0e0' : '#333',
                  cursor: 'pointer',
                  fontSize: '11px',
                  flexShrink: 0,
                }}
              >
                Color
              </button>
            </label>
            {path.walk && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  columnGap: '10px',
                  rowGap: '4px',
                  paddingLeft: '22px',
                  color: isDarkMode ? '#aaa' : '#666',
                  fontSize: '11px',
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ color: isDarkMode ? '#ddd' : '#444' }}>
                  W
                </strong>
                <span>Sample: {path.walk.sampleName}</span>
                <span>Haplotype: {path.walk.haplotypeIndex}</span>
                <span>Sequence: {path.walk.sequenceName}</span>
                <span>
                  Coordinates:{' '}
                  {formatWalkCoordinate(path.walk.sequenceStart)}
                  {' - '}
                  {formatWalkCoordinate(path.walk.sequenceEnd)}
                </span>
                {path.walk.tags.length > 0 && (
                  <span
                    title={path.walk.tags.join('\t')}
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    Tags: {path.walk.tags.join(', ')}
                  </span>
                )}
              </div>
            )}
            {activeColorPathName === path.name && (
              <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingLeft: '22px',
                flexWrap: 'wrap',
              }}
              >
                {colorPresets.map(color => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color nodes ${color}`}
                    onClick={() => {
                      applyNodeColor(path.name, color)
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '4px',
                      border: isDarkMode ? '1px solid #777' : '1px solid #aaa',
                      background: color,
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <input
                  type="text"
                  value={nodeColorInput}
                  onChange={event => setNodeColorInput(event.currentTarget.value)}
                  style={{
                    width: '82px',
                    boxSizing: 'border-box',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
                    background: isDarkMode ? '#1f1f1f' : '#fff',
                    color: isDarkMode ? '#e0e0e0' : '#333',
                    fontSize: '12px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => applyNodeColor(path.name, nodeColorInput)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: isDarkMode ? '1px solid #555' : '1px solid #ccc',
                    background: isDarkMode ? '#3a3a3a' : '#fff',
                    color: isDarkMode ? '#e0e0e0' : '#333',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Apply
                </button>
                {colorFeedback?.pathName === path.name && (
                  <span
                    style={{
                      color: colorFeedback.isError
                        ? '#ef5350'
                        : isDarkMode
                          ? '#aaa'
                          : '#666',
                      fontSize: '11px',
                    }}
                  >
                    {colorFeedback.message}
                  </span>
                )}
              </div>
            )}
          </div>
          )
        })}
        {filteredPaths.length === 0 && (
          <div
            style={{
              color: isDarkMode ? '#888' : '#777',
              fontSize: '12px',
              padding: '8px 2px',
            }}
          >
            No paths match "{searchQuery}".
          </div>
        )}
      </div>
    </div>
  )
}
