import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_TABLE_MAX_COLUMN_WIDTH,
  MARKDOWN_TABLE_MIN_COLUMN_WIDTH,
  markdownTableColumnWidths,
  markdownTableWidth
} from './mobile-markdown-table-widths'

describe('markdownTableColumnWidths', () => {
  it('uses one bounded width per visible column', () => {
    const widths = markdownTableColumnWidths(
      ['Check', 'Expected'],
      [
        ['中文输入', '可读'],
        ['Source preview', 'Syntax and zoom work']
      ]
    )

    expect(widths).toHaveLength(2)
    expect(widths[0]).toBeGreaterThanOrEqual(MARKDOWN_TABLE_MIN_COLUMN_WIDTH)
    expect(widths[1]).toBeGreaterThan(widths[0]!)
    expect(markdownTableWidth(widths)).toBe(widths[0]! + widths[1]!)
  })

  it('accounts for wide CJK text and clamps very long cells', () => {
    const widths = markdownTableColumnWidths(
      ['Status', 'Trace'],
      [
        ['中文输入验证通过继续可读', 'short'],
        ['ok', 'x'.repeat(200)]
      ]
    )

    expect(widths[0]).toBeGreaterThan(MARKDOWN_TABLE_MIN_COLUMN_WIDTH)
    expect(widths[1]).toBe(MARKDOWN_TABLE_MAX_COLUMN_WIDTH)
  })

  it('sizes by visible markdown text rather than link syntax noise', () => {
    const widths = markdownTableColumnWidths(
      ['[Label](https://example.com/really/long/url)', '`code.ts`'],
      [['Plain', '**bold**']]
    )

    expect(widths).toEqual([MARKDOWN_TABLE_MIN_COLUMN_WIDTH, MARKDOWN_TABLE_MIN_COLUMN_WIDTH])
  })

  it('stops scanning a column once its bounded maximum is reached', () => {
    const unreadRow = Object.defineProperty([], '0', {
      get() {
        throw new Error('row should not be read after the column reaches its maximum')
      }
    }) as readonly string[]
    const widths = markdownTableColumnWidths(['Trace'], [['x'.repeat(200)], unreadRow])

    expect(widths).toEqual([MARKDOWN_TABLE_MAX_COLUMN_WIDTH])
  })
})
