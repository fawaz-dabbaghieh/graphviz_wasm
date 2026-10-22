// Parses a BandageNG-compatible node styling CSV/TSV and applies it to the
// app's Graph model. Kept dependency-free (no React) so it's unit-testable
// in isolation and reusable from anywhere.
import type { GraphNode } from '../types'
import { stripNodeOrientation } from './displayGraph'

export interface NodeStyleRow {
  nodeName: string // bare, orientation stripped
  orientation: '+' | '-' | null
  colour: string | null // resolved to #rrggbb (alpha, if any, is dropped)
  category: string | null // raw colour-column text when it was not a colour
  label: string | null
  extra: Record<string, string>
  lineNumber: number
}

export interface NodeStyleCsv {
  rows: NodeStyleRow[]
  headers: string[]
  colourColumnIndex: number | null
  labelColumnIndex: number | null
  categoryColours: Record<string, string>
  separator: '\t' | ','
}

export interface ApplyNodeStyleCsvResult {
  colorOverrides: Record<string, string> // keyed by display node id (with +/-)
  labelOverrides: Record<string, string>
  metadata: Record<string, Record<string, string>>
  matchedNodes: number // distinct bare segment names matched
  unmatchedRows: number[] // line numbers, for the warning
}

// A fixed, qualitative palette (ColorBrewer "Dark2", 8 classes) so repeated
// loads of the same CSV always assign the same category a stable colour.
// Cycles if a CSV has more than 8 distinct non-colour values in its colour
// column.
const CATEGORY_PALETTE = [
  '#1b9e77',
  '#d95f02',
  '#7570b3',
  '#e7298a',
  '#66a61e',
  '#e6ab02',
  '#a6761d',
  '#666666',
]

// The standard CSS3/SVG named colours. A CSV's colour column is allowed to
// use these directly (BandageNG does), so they need to resolve to hex the
// same way a browser's own CSS parser would - without depending on a DOM/
// canvas context, which would make this module untestable outside a
// browser.
const CSS_COLOR_NAMES: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
}

const HEX6_PATTERN = /^#?([0-9a-fA-F]{6})$/
const HEX8_PATTERN = /^#?([0-9a-fA-F]{8})$/

// Resolves a colour-column cell to a plain #rrggbb, or null when the value
// isn't a recognizable colour at all (the caller then treats it as a
// category label instead). 8-digit hex is BandageNG's "leading alpha"
// convention (AARRGGBB); the canvas renderer has no alpha-blending concept
// for node fills, so the alpha byte is simply dropped rather than plumbing
// transparency through the whole rendering pipeline for this one input.
function resolveColour(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const hex8Match = HEX8_PATTERN.exec(trimmed)
  if (hex8Match) {
    return `#${hex8Match[1]!.slice(2)}`.toLowerCase()
  }

  const hex6Match = HEX6_PATTERN.exec(trimmed)
  if (hex6Match) {
    return `#${hex6Match[1]!}`.toLowerCase()
  }

  const named = CSS_COLOR_NAMES[trimmed.toLowerCase()]
  return named ?? null
}

function detectSeparator(firstLine: string): '\t' | ',' {
  return firstLine.includes('\t') ? '\t' : ','
}

// Minimal CSV/TSV field split. BandageNG's own CSVs don't quote fields (plain
// tab- or comma-separated values), so this deliberately doesn't implement
// quoted-field escaping - matching the format this needs to stay compatible
// with rather than general CSV.
function splitRow(line: string, separator: '\t' | ','): string[] {
  return line.split(separator)
}

export function parseNodeStyleCsv(text: string): NodeStyleCsv {
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(entry => entry.line.trim().length > 0)

  if (lines.length === 0) {
    throw new Error('Node styling file is empty.')
  }

  const separator = detectSeparator(lines[0]!.line)
  const headerFields = splitRow(lines[0]!.line, separator).map(field =>
    field.trim(),
  )

  if (headerFields.length < 2) {
    throw new Error(
      'Node styling file must have at least two columns (node name plus at least one style column).',
    )
  }

  const normalizedHeaders = headerFields.map(header =>
    header.trim().toLowerCase(),
  )
  const colourColumnIndex = normalizedHeaders.findIndex(
    header => header === 'colour' || header === 'color',
  )
  const labelColumnIndex = normalizedHeaders.findIndex(
    header => header === 'label',
  )

  const rows: NodeStyleRow[] = []
  // Assigned in first-seen order so repeated loads of the same file are
  // stable; a Map preserves insertion order, which is all "first-seen" needs.
  const categoryColours = new Map<string, string>()

  for (const { line, lineNumber } of lines.slice(1)) {
    const fields = splitRow(line, separator)
    const rawName = fields[0]?.trim() ?? ''
    if (!rawName) continue

    let orientation: '+' | '-' | null = null
    let nodeName = rawName
    if (rawName.endsWith('+') || rawName.endsWith('-')) {
      orientation = rawName.endsWith('+') ? '+' : '-'
      nodeName = stripNodeOrientation(rawName)
    }

    let colour: string | null = null
    let category: string | null = null
    if (colourColumnIndex !== -1) {
      const rawColour = fields[colourColumnIndex]?.trim() ?? ''
      if (rawColour) {
        const resolved = resolveColour(rawColour)
        if (resolved) {
          colour = resolved
        } else {
          category = rawColour
          if (!categoryColours.has(rawColour)) {
            categoryColours.set(
              rawColour,
              CATEGORY_PALETTE[categoryColours.size % CATEGORY_PALETTE.length]!,
            )
          }
          colour = categoryColours.get(rawColour)!
        }
      }
    }

    const label =
      labelColumnIndex !== -1
        ? fields[labelColumnIndex]?.trim() || null
        : null

    const extra: Record<string, string> = {}
    headerFields.forEach((header, index) => {
      if (
        index === 0 ||
        index === colourColumnIndex ||
        index === labelColumnIndex
      ) {
        return
      }
      const value = fields[index]?.trim()
      if (value) extra[header] = value
    })

    rows.push({
      nodeName,
      orientation,
      colour,
      category,
      label,
      extra,
      lineNumber,
    })
  }

  if (rows.length === 0) {
    throw new Error('Node styling file has no data rows.')
  }

  return {
    rows,
    headers: headerFields,
    colourColumnIndex: colourColumnIndex === -1 ? null : colourColumnIndex,
    labelColumnIndex: labelColumnIndex === -1 ? null : labelColumnIndex,
    categoryColours: Object.fromEntries(categoryColours),
    separator,
  }
}

export function applyNodeStyleCsv(
  csv: NodeStyleCsv,
  nodes: GraphNode[],
): ApplyNodeStyleCsvResult {
  // Display node ids are orientation-expanded (gfaConverter.ts creates both
  // `<seg>+` and `<seg>-`), but a CSV from an external tool only knows the
  // bare segment name - so matching has to go through the bare name, then
  // fan out to whichever oriented id(s) actually exist in this graph.
  const nodeIdsByBareName = new Map<string, string[]>()
  for (const node of nodes) {
    const bareName = stripNodeOrientation(node.id)
    const existing = nodeIdsByBareName.get(bareName)
    if (existing) {
      existing.push(node.id)
    } else {
      nodeIdsByBareName.set(bareName, [node.id])
    }
  }

  const colorOverrides: Record<string, string> = {}
  const labelOverrides: Record<string, string> = {}
  const metadata: Record<string, Record<string, string>> = {}
  const matchedBareNames = new Set<string>()
  const unmatchedRows: number[] = []

  for (const row of csv.rows) {
    const candidateIds = nodeIdsByBareName.get(row.nodeName) ?? []
    const targetIds = row.orientation
      ? candidateIds.filter(id => id.endsWith(row.orientation!))
      : candidateIds

    if (targetIds.length === 0) {
      unmatchedRows.push(row.lineNumber)
      continue
    }

    matchedBareNames.add(row.nodeName)

    for (const nodeId of targetIds) {
      if (row.colour) colorOverrides[nodeId] = row.colour
      if (row.label) labelOverrides[nodeId] = row.label
      if (Object.keys(row.extra).length > 0) {
        metadata[nodeId] = { ...metadata[nodeId], ...row.extra }
      }
    }
  }

  return {
    colorOverrides,
    labelOverrides,
    metadata,
    matchedNodes: matchedBareNames.size,
    unmatchedRows,
  }
}
