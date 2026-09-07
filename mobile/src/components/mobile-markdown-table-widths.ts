import { spacing } from '../theme/mobile-theme'

export const MARKDOWN_TABLE_MIN_COLUMN_WIDTH = 112
export const MARKDOWN_TABLE_MAX_COLUMN_WIDTH = 220

const CELL_TEXT_UNIT_WIDTH = 7
const CELL_HORIZONTAL_PADDING = spacing.sm * 2
const MAX_TEXT_UNITS_FOR_COLUMN =
  (MARKDOWN_TABLE_MAX_COLUMN_WIDTH - CELL_HORIZONTAL_PADDING) / CELL_TEXT_UNIT_WIDTH

function isWideTableCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )
}

function visibleTableCellText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(
      /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g,
      '$1$2$3$4$5$6'
    )
    .replace(/\\([\\`*_[\]()~])/g, '$1')
    .trim()
}

function tableCellTextUnits(value: string): number {
  let units = 0
  for (const char of visibleTableCellText(value)) {
    const codePoint = char.codePointAt(0)
    if (codePoint == null) {
      continue
    }
    if (/\s/u.test(char)) {
      units += 0.5
    } else {
      units += isWideTableCodePoint(codePoint) ? 2 : 1
    }
  }
  return units
}

function clampTableColumnWidth(width: number): number {
  return Math.max(MARKDOWN_TABLE_MIN_COLUMN_WIDTH, Math.min(MARKDOWN_TABLE_MAX_COLUMN_WIDTH, width))
}

function tableColumnWidthForUnits(units: number): number {
  return clampTableColumnWidth(Math.ceil(units * CELL_TEXT_UNIT_WIDTH + CELL_HORIZONTAL_PADDING))
}

export function markdownTableColumnWidths(
  headers: readonly string[],
  rows: ReadonlyArray<readonly string[]>
): number[] {
  return headers.map((header, columnIndex) => {
    let largestCellUnits = tableCellTextUnits(header)
    if (largestCellUnits >= MAX_TEXT_UNITS_FOR_COLUMN) {
      return MARKDOWN_TABLE_MAX_COLUMN_WIDTH
    }
    for (const row of rows) {
      largestCellUnits = Math.max(largestCellUnits, tableCellTextUnits(row[columnIndex] ?? ''))
      if (largestCellUnits >= MAX_TEXT_UNITS_FOR_COLUMN) {
        return MARKDOWN_TABLE_MAX_COLUMN_WIDTH
      }
    }
    return tableColumnWidthForUnits(largestCellUnits)
  })
}

export function markdownTableWidth(columnWidths: readonly number[]): number {
  return columnWidths.reduce((total, width) => total + width, 0)
}
