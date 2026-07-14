import type { BedAnnotation, BedAnnotationColumn } from '../types'

interface ColumnRoles {
  id: number
  chromosome: number
  start: number
  end: number
}

interface ParseBedAnnotationOptions {
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

function splitFields(line: string): string[] {
  return line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/)
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
): number {
  const candidateSet = new Set(candidates)

  for (let index = 0; index < normalizedHeader.length; index += 1) {
    if (allowedIndexes && !allowedIndexes.has(index)) continue

    if (candidateSet.has(normalizedHeader[index])) {
      return index
    }
  }

  return -1
}

function resolveColumnRoles(
  header: string[],
  selectedIndexes: number[],
  options: ParseBedAnnotationOptions,
): ColumnRoles {
  const normalizedHeader = header.map(normalizeHeader)
  const allowedIndexes = new Set(selectedIndexes)
  const chromosome = findHeaderIndex(normalizedHeader, CHROMOSOME_HEADERS)
  const start =
    parseOptionalColumnIndex(options.startColumn, 'Start', header.length) ??
    findHeaderIndex(normalizedHeader, START_HEADERS)
  const end =
    parseOptionalColumnIndex(options.endColumn, 'End', header.length) ??
    findHeaderIndex(normalizedHeader, END_HEADERS)
  let id = findHeaderIndex(normalizedHeader, ID_HEADERS, allowedIndexes)

  if (id < 0) {
    id = findHeaderIndex(normalizedHeader, ID_HEADERS)
  }

  if (id < 0) {
    id =
      selectedIndexes.find(
        index => index !== chromosome && index !== start && index !== end,
      ) ?? -1
  }

  if (chromosome < 0 || start < 0 || end < 0) {
    throw new Error(
      'Could not identify chromosome/start/end from the selected headers. Include columns with headers like chrom, chromStart, chromEnd, name, thickStart, or thickEnd.',
    )
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
  const nonEmptyLines = rawLines
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(
      entry =>
        entry.line &&
        !entry.line.toLowerCase().startsWith('track ') &&
        !entry.line.toLowerCase().startsWith('browser '),
    )

  const headerEntry = nonEmptyLines.find(
    entry =>
      !entry.line.startsWith('#') ||
      /^#\s*(bin|chrom|chromosome|gene|id|name)\b/i.test(entry.line),
  )

  if (!headerEntry) {
    throw new Error('Annotation file must include a header row.')
  }

  const dataLines = nonEmptyLines.filter(
    entry =>
      entry.lineNumber > headerEntry.lineNumber && !entry.line.startsWith('#'),
  )

  if (dataLines.length === 0) {
    throw new Error(
      'Annotation file must include a header row and at least one data row.',
    )
  }

  const header = splitFields(headerEntry.line.replace(/^#\s*/, ''))
  const selectedIndexes = parseColumnSelection(columnSelection, header.length)
  const roles = resolveColumnRoles(header, selectedIndexes, options)
  const annotations: BedAnnotation[] = []

  for (const { line, lineNumber } of dataLines) {
    const fields = splitFields(line)
    const start = parseInteger(fields[roles.start] ?? '')
    const end = parseInteger(fields[roles.end] ?? '')

    if (start === null || end === null || end <= start) continue

    const chromosome = fields[roles.chromosome]?.trim()
    if (!chromosome) continue

    annotations.push({
      id: fields[roles.id]?.trim() || `line-${lineNumber}`,
      chromosome,
      start,
      end,
      lineNumber,
      columns: buildDisplayColumns(header, fields, selectedIndexes),
    })
  }

  if (annotations.length === 0) {
    throw new Error(
      'No usable annotation rows found after applying the selected columns.',
    )
  }

  return annotations
}
