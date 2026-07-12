import { useMemo, useRef, useState } from 'react'
import type { BedAnnotation } from '../types'
import { parseBedAnnotations } from '../utils/bedAnnotations'

interface BedAnnotationPanelProps {
  annotations: BedAnnotation[]
  selectedAnnotation: BedAnnotation | null
  onAnnotationsChange: (annotations: BedAnnotation[]) => void
  onSelectAnnotation: (annotation: BedAnnotation, flankBp: number) => void
}

function annotationKey(annotation: BedAnnotation): string {
  return `${annotation.lineNumber}:${annotation.id}:${annotation.chromosome}:${annotation.start}:${annotation.end}`
}

export function BedAnnotationPanel({
  annotations,
  selectedAnnotation,
  onAnnotationsChange,
  onSelectAnnotation,
}: BedAnnotationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [filename, setFilename] = useState('')
  const [fileText, setFileText] = useState('')
  const [columnSelection, setColumnSelection] = useState('1,2,3,4')
  const [startColumn, setStartColumn] = useState('')
  const [endColumn, setEndColumn] = useState('')
  const [flankBpInput, setFlankBpInput] = useState('1000')
  const [parseError, setParseError] = useState<string | null>(null)

  const filteredAnnotations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return annotations

    return annotations.filter(annotation => {
      const displayValues = annotation.columns
        .map(column => column.value)
        .join(' ')
        .toLowerCase()

      return (
        annotation.id.toLowerCase().includes(normalizedQuery) ||
        annotation.chromosome.toLowerCase().includes(normalizedQuery) ||
        String(annotation.start).includes(normalizedQuery) ||
        String(annotation.end).includes(normalizedQuery) ||
        displayValues.includes(normalizedQuery)
      )
    })
  }, [annotations, query])

  const visibleAnnotations = filteredAnnotations.slice(0, 500)
  const selectedKey = selectedAnnotation
    ? annotationKey(selectedAnnotation)
    : null
  const tableColumns = visibleAnnotations[0]?.columns ?? []

  const parseLoadedFile = (text: string, nextFilename: string) => {
    const parsedAnnotations = parseBedAnnotations(text, columnSelection, {
      startColumn,
      endColumn,
    })
    onAnnotationsChange(parsedAnnotations)
    setFilename(nextFilename)
    setParseError(null)
    setQuery('')
  }

  const handleApplyColumns = () => {
    if (!fileText) return

    try {
      parseLoadedFile(fileText, filename)
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : 'Failed to parse annotation file',
      )
      onAnnotationsChange([])
    }
  }

  const handleUseAnnotation = (annotation: BedAnnotation) => {
    const flankBp = Number(flankBpInput)
    if (!Number.isInteger(flankBp) || flankBp < 0) {
      setParseError('Flank must be a non-negative integer')
      return
    }

    setParseError(null)
    onSelectAnnotation(annotation, flankBp)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = readEvent => {
      try {
        const text = readEvent.target?.result
        if (typeof text !== 'string') {
          throw new Error('Failed to read annotation file as text')
        }

        setFileText(text)
        parseLoadedFile(text, file.name)
      } catch (error) {
        setParseError(
          error instanceof Error
            ? error.message
            : 'Failed to parse annotation file',
        )
        setFilename(file.name)
        onAnnotationsChange([])
      }
    }
    reader.onerror = () => {
      setParseError('Failed to read annotation file')
      onAnnotationsChange([])
    }
    reader.readAsText(file)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="annotation-panel">
      <div className="annotation-toolbar">
        <div>
          <h3>Annotation Table</h3>
          <div className="annotation-summary">
            {filename
              ? `${filename} - ${annotations.length.toLocaleString()} rows`
              : 'Load a BED or simple TSV annotation file.'}
          </div>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          Load BED/TSV
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bed,.tsv,.txt"
        className="hidden-file-input"
        onChange={handleFileChange}
      />

      {parseError && <div className="control-error">{parseError}</div>}

      <div className="annotation-config-grid">
        <div className="control-group">
          <label htmlFor="annotation-column-selection">
            <strong>Columns</strong>
          </label>
          <input
            id="annotation-column-selection"
            className="control-input"
            type="text"
            value={columnSelection}
            onChange={event => setColumnSelection(event.currentTarget.value)}
            placeholder="1,2,4,5,7,8"
          />
          <div className="control-hint">
            1-based column numbers. The first row is used as the header.
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="annotation-start-column">
            <strong>Start Col</strong>
          </label>
          <input
            id="annotation-start-column"
            className="control-input"
            type="number"
            min="1"
            step="1"
            value={startColumn}
            onChange={event => setStartColumn(event.currentTarget.value)}
            placeholder="auto"
          />
          <div className="control-hint">Blank uses header names.</div>
        </div>

        <div className="control-group">
          <label htmlFor="annotation-end-column">
            <strong>End Col</strong>
          </label>
          <input
            id="annotation-end-column"
            className="control-input"
            type="number"
            min="1"
            step="1"
            value={endColumn}
            onChange={event => setEndColumn(event.currentTarget.value)}
            placeholder="auto"
          />
          <div className="control-hint">Blank uses header names.</div>
        </div>

        <div className="control-group">
          <label htmlFor="annotation-flank-bp">
            <strong>Flank bp</strong>
          </label>
          <input
            id="annotation-flank-bp"
            className="control-input"
            type="number"
            min="0"
            step="1"
            value={flankBpInput}
            onChange={event => setFlankBpInput(event.currentTarget.value)}
          />
          <div className="control-hint">
            Added upstream and downstream when using a row.
          </div>
        </div>

        <button
          className="secondary-button annotation-apply-button"
          type="button"
          onClick={handleApplyColumns}
          disabled={!fileText}
        >
          Apply Settings
        </button>
      </div>

      <div className="annotation-search-row">
        <input
          className="control-input"
          type="search"
          placeholder="Search gene, chromosome, start, or end"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          disabled={annotations.length === 0}
        />
      </div>

      {selectedAnnotation && (
        <div className="annotation-selection">
          Selected {selectedAnnotation.id} at {selectedAnnotation.chromosome}:
          {selectedAnnotation.start.toLocaleString()}-
          {selectedAnnotation.end.toLocaleString()}
        </div>
      )}

      <div className="annotation-table-wrap">
        {annotations.length === 0 ? (
          <div className="placeholder annotation-placeholder">
            <p>No annotation file loaded</p>
          </div>
        ) : filteredAnnotations.length === 0 ? (
          <div className="placeholder annotation-placeholder">
            <p>No matching annotations</p>
          </div>
        ) : (
          <table className="annotation-table">
            <thead>
              <tr>
                {tableColumns.map(column => (
                  <th key={`${column.index}:${column.header}`}>
                    {column.header}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleAnnotations.map(annotation => {
                const key = annotationKey(annotation)
                return (
                  <tr
                    key={key}
                    className={key === selectedKey ? 'selected' : undefined}
                  >
                    {annotation.columns.map(column => (
                      <td key={`${column.index}:${column.header}`}>
                        {column.value}
                      </td>
                    ))}
                    <td>
                      <button
                        className="table-action-button"
                        type="button"
                        onClick={() => handleUseAnnotation(annotation)}
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {filteredAnnotations.length > visibleAnnotations.length && (
        <div className="control-hint">
          Showing first {visibleAnnotations.length.toLocaleString()} matching
          rows. Refine the search to narrow the table.
        </div>
      )}
    </div>
  )
}
