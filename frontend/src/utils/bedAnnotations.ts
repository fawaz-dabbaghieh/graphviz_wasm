import type { BedAnnotation, BedAnnotationColumn } from '../types'

interface ColumnRoles {
  id: number | null
  chromosome: number | null
  start: number | null
  end: number | null
}

interface ParseBedAnnotationOptions {
  idColumn?: string
  chromosomeColumn?: string
  startColumn?: string
  endColumn?: string
}

const ID_HEADERS = [
  'gene',
  'gene_id',
  'geneid',
  'gene_name',
  'genename',
  'id',
  'name',
  'name2',
]
const CHROMOSOME_HEADERS = ['chrom', 'chromosome', 'chr', 'seqid', 'sequence']
const START_HEADERS = [
  'chromstart',
  'txstart',
  'start',
  'thickstart',
  'cdsstart',
]
const END_HEADERS = ['chromend', 'txend', 'end', 'stop', 'thickend', 'cdsend']
const KNOWN_HEADERS = new Set([
  ...ID_HEADERS,
  ...CHROMOSOME_HEADERS,
  ...START_HEADERS,
  ...END_HEADERS,
])

function splitFields(line: string): string[] {
  if (!line.includes('\t')) {
    throw new Error('Annotation files must contain tab-separated columns.')
  }

  return line.split('\t')
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseColumnSelection(input: string, headerLength: number): number[] {
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    return Array.from({ length: headerLength }, (_, index) => index)
  }

  const selectedIndexes = trimmedInput.split(',').map(value => {
    const parsed = Number(value.trim())
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > headerLength) {
      throw new Error(
        `Column "${value.trim()}" is invalid. Enter 1-based column numbers between 1 and ${headerLength}.`,
      )
    }

    return parsed - 1
  })

  return Array.from(new Set(selectedIndexes))
}

function parseOptionalColumnIndex(
  input: string | undefined,
  label: string,
  headerLength: number,
): number | null {
  const trimmedInput = input?.trim()
  if (!trimmedInput) return null

  const parsed = Number(trimmedInput)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > headerLength) {
    throw new Error(
      `${label} column must be a 1-based column number between 1 and ${headerLength}.`,
    )
  }

  return parsed - 1
}

function findHeaderIndex(
  normalizedHeader: string[],
  candidates: string[],
  allowedIndexes?: Set<number>,
): number | null {
  const candidateSet = new Set(candidates)

  for (let index = 0; index < normalizedHeader.length; index += 1) {
    if (allowedIndexes && !allowedIndexes.has(index)) continue

    if (candidateSet.has(normalizedHeader[index])) {
      return index
    }
  }

  return null
}

function resolveColumnRoles(
  header: string[],
  selectedIndexes: number[],
  options: ParseBedAnnotationOptions,
): ColumnRoles {
  const normalizedHeader = header.map(normalizeHeader)
  const allowedIndexes = new Set(selectedIndexes)
  const chromosome =
    parseOptionalColumnIndex(
      options.chromosomeColumn,
      'Chromosome',
      header.length,
    ) ?? findHeaderIndex(normalizedHeader, CHROMOSOME_HEADERS)
  const start =
    parseOptionalColumnIndex(options.startColumn, 'Start', header.length) ??
    findHeaderIndex(normalizedHeader, START_HEADERS)
  const end =
    parseOptionalColumnIndex(options.endColumn, 'End', header.length) ??
    findHeaderIndex(normalizedHeader, END_HEADERS)
  let id =
    parseOptionalColumnIndex(options.idColumn, 'Name/ID', header.length) ??
    findHeaderIndex(normalizedHeader, ID_HEADERS, allowedIndexes)

  if (id === null) {
    id = findHeaderIndex(normalizedHeader, ID_HEADERS)
  }

  if (id === null) {
    id =
      selectedIndexes.find(
        index => index !== chromosome && index !== start && index !== end,
      ) ?? null
  }

  return { id, chromosome, start, end }
}

function buildDisplayColumns(
  header: string[],
  fields: string[],
  selectedIndexes: number[],
): BedAnnotationColumn[] {
  return selectedIndexes.map(index => ({
    index: index + 1,
    header: header[index] || `Column ${index + 1}`,
    value: fields[index]?.trim() ?? '',
  }))
}

export function parseBedAnnotations(
  text: string,
  columnSelection: string,
  options: ParseBedAnnotationOptions = {},
): BedAnnotation[] {
  const rawLines = text.split(/\r?\n/)
  const tableLines = rawLines
    .map((line, index) => ({ line: line.trimEnd(), lineNumber: index + 1 }))
    .filter(
      entry =>
        entry.line.trim() &&
        !entry.line.trimStart().toLowerCase().startsWith('track ') &&
        !entry.line.trimStart().toLowerCase().startsWith('browser ') &&
        (!entry.line.trimStart().startsWith('#') || entry.line.includes('\t')),
    )

  if (tableLines.length === 0) {
    throw new Error('Annotation file does not contain any tabular rows.')
  }

  const firstEntry = tableLines[0]!
  const firstFields = splitFields(
    firstEntry.line.trimStart().replace(/^#\s*/, ''),
  )
  const normalizedFirstFields = firstFields.map(normalizeHeader)
  const firstRowIsHeader =
    firstEntry.line.trimStart().startsWith('#') ||
    normalizedFirstFields.some(field => KNOWN_HEADERS.has(field)) ||
    firstFields.every(field => parseInteger(field) === null)
  const header = firstRowIsHeader
    ? firstFields.map((field, index) => field.trim() || `Column ${index + 1}`)
    : firstFields.map((_, index) => `Column ${index + 1}`)
  const dataLines = tableLines.filter(
    (entry, index) =>
      (!firstRowIsHeader || index > 0) &&
      !entry.line.trimStart().startsWith('#'),
  )

  if (dataLines.length === 0) {
    throw new Error(
      firstRowIsHeader
        ? 'Annotation file must include at least one data row after the header.'
        : 'Annotation file must include at least one tab-separated data row.',
    )
  }

  const selectedIndexes = parseColumnSelection(columnSelection, header.length)
  const roles = resolveColumnRoles(header, selectedIndexes, options)
  const annotations: BedAnnotation[] = []

  for (const { line, lineNumber } of dataLines) {
    let fields: string[]
    try {
      fields = splitFields(line)
    } catch {
      throw new Error(`Line ${lineNumber} is not tab-separated.`)
    }

    const chromosome =
      roles.chromosome === null
        ? null
        : fields[roles.chromosome]?.trim() || null
    const start =
      roles.start === null
        ? null
        : parseInteger(fields[roles.start] ?? '')
    const end =
      roles.end === null ? null : parseInteger(fields[roles.end] ?? '')
    const id =
      roles.id === null ? '' : fields[roles.id]?.trim() ?? ''

    annotations.push({
      id: id || `line-${lineNumber}`,
      chromosome,
      start,
      end,
      lineNumber,
      columns: buildDisplayColumns(header, fields, selectedIndexes),
    })
  }

  if (annotations.length === 0) {
    throw new Error('Annotation file does not contain any data rows.')
  }

  return annotations
}
