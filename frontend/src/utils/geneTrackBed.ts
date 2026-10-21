// Parses a (strict, standard) BED file for the gene track drawn above the
// linear-layout ruler. Deliberately separate from bedAnnotations.ts, which
// parses a much more permissive "pick your own id/chrom/start/end columns"
// annotation format for an unrelated feature (coordinate-region lookup, not
// canvas rendering) - see the spec's note that the two must not be conflated.
export interface GeneRecord {
  chrom: string
  start: number // 0-based, inclusive (BED convention)
  end: number // 0-based, exclusive (BED convention)
  name: string
  score: string
  strand: '+' | '-' | null
  lineNumber: number
}

function parseStrand(value: string | undefined): '+' | '-' | null {
  if (value === '+' || value === '-') return value
  return null
}

export function parseGeneTrackBed(text: string): GeneRecord[] {
  const rawLines = text.split(/\r?\n/)
  const genes: GeneRecord[] = []

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line) return
    const lower = line.toLowerCase()
    if (lower.startsWith('track ') || lower.startsWith('browser ')) return
    if (line.startsWith('#')) return

    const fields = rawLine.split('\t')
    if (fields.length < 3) {
      throw new Error(
        `Line ${lineNumber}: a BED row needs at least chrom, start, and end (tab-separated).`,
      )
    }

    const chrom = fields[0]!.trim()
    const start = Number(fields[1])
    const end = Number(fields[2])
    if (!chrom || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(
        `Line ${lineNumber}: chrom/start/end could not be parsed.`,
      )
    }

    genes.push({
      chrom,
      start,
      end,
      name: fields[3]?.trim() || `line-${lineNumber}`,
      score: fields[4]?.trim() ?? '0',
      strand: parseStrand(fields[5]?.trim()),
      lineNumber,
    })
  })

  if (genes.length === 0) {
    throw new Error('BED file has no data rows.')
  }

  return genes
}

// The ruler's sequenceName comes from path.walk.sequenceName (e.g. "chr1"),
// but a BED's chrom column may carry a PanSN prefix (e.g. "CHM13#0#chr1") if
// it was generated against a haplotype-qualified reference name. Comparing
// on just the part after the last '#' lets both spellings match the same
// reference without guessing at a specific naming convention.
export function stripPanSNPrefix(sequenceName: string): string {
  const lastHashIndex = sequenceName.lastIndexOf('#')
  return lastHashIndex === -1
    ? sequenceName
    : sequenceName.slice(lastHashIndex + 1)
}
