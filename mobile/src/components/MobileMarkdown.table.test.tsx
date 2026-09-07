import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

let renderer: ReactTestRenderer | undefined

afterEach(() => {
  renderer?.unmount()
  renderer = undefined
  vi.restoreAllMocks()
})

function render(content: string): ReactTestRenderer {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content }))
  })
  return renderer!
}

function flattenStyle(value: unknown): Record<string, unknown>[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStyle(item))
  }
  return [value as Record<string, unknown>]
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

function tableCells(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((node) => {
    if (node.type !== ('Text' as never)) {
      return false
    }
    return flattenStyle(node.props.style).some((style) => style.borderRightWidth === 1)
  })
}

function cellWidth(cell: ReactTestInstance): number {
  const width = flattenStyle(cell.props.style).find(
    (style) => typeof style.width === 'number'
  )?.width
  expect(width).toEqual(expect.any(Number))
  return width as number
}

describe('MobileMarkdown table rendering', () => {
  it('renders all rows on the same bounded column grid', () => {
    const tree = render(`
| Check | Expected |
| --- | --- |
| 中文输入 | 可读 |
| Source preview | Syntax and zoom work |
`)
    const cells = tableCells(tree)

    expect(cells.map(textContent)).toEqual([
      'Check',
      'Expected',
      '中文输入',
      '可读',
      'Source preview',
      'Syntax and zoom work'
    ])
    expect(cells.map((cell) => cell.props.selectable)).toEqual([true, true, true, true, true, true])

    const widths = cells.map(cellWidth)
    expect(widths[0]).toBe(widths[2])
    expect(widths[0]).toBe(widths[4])
    expect(widths[1]).toBe(widths[3])
    expect(widths[1]).toBe(widths[5])
    expect(widths[1]).toBeGreaterThan(widths[0]!)
  })

  it('recomputes the shared grid deterministically after rerender', () => {
    const tree = render(`
| Name | State |
| --- | --- |
| Orca | Open |
`)
    const initialWidths = tableCells(tree).map(cellWidth)

    act(() =>
      tree.update(
        createElement(MobileMarkdown, {
          content: `
| Name | State |
| --- | --- |
| Orca | Open |
| Long workspace | Needs horizontally scrollable stable columns |
`
        })
      )
    )

    const widths = tableCells(tree).map(cellWidth)
    expect(widths[0]).toBe(initialWidths[0])
    expect(widths[2]).toBe(widths[0])
    expect(widths[4]).toBe(widths[0])
    expect(widths[1]).toBe(widths[3])
    expect(widths[1]).toBe(widths[5])
    expect(widths[1]).toBeGreaterThan(initialWidths[1]!)
  })
})
