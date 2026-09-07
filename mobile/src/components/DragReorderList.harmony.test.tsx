import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { Pressable, Text } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DragReorderList } from './DragReorderList.harmony'

const triggerSelection = vi.hoisted(() => vi.fn())

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp'
}))

vi.mock('../platform/haptics', () => ({
  triggerSelection
}))

const harmonySource = readFileSync(
  new URL('./DragReorderList.harmony.tsx', import.meta.url),
  'utf8'
)
const settingsSource = readFileSync(
  new URL('./TerminalShortcutSettings.tsx', import.meta.url),
  'utf8'
)

type Item = { id: string; label: string }

const items: Item[] = [
  { id: 'escape', label: 'Esc' },
  { id: 'tab', label: 'Tab' },
  { id: 'ctrl-c', label: 'Ctrl-C' }
]

function renderList(
  onReorder = vi.fn<(keys: string[]) => void>(),
  nextItems = items
): ReactTestRenderer {
  return create(
    createElement(DragReorderList<Item>, {
      items: nextItems,
      itemKey: (item) => item.id,
      onReorder,
      renderRow: (item) => createElement(Text, null, item.label),
      rowHeight: 56,
      scrollContentHeight: { value: 0 },
      scrollOffsetY: { value: 0 },
      scrollRef: {}
    })
  )
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

describe('DragReorderList Harmony touch controls', () => {
  it('moves a row up through visible touch controls', () => {
    const onReorder = vi.fn<(keys: string[]) => void>()
    act(() => {
      renderer = renderList(onReorder)
    })

    const buttons = renderer!.root.findAllByType(Pressable)
    act(() => {
      buttons[2]!.props.onPress()
    })

    expect(onReorder).toHaveBeenCalledWith(['tab', 'escape', 'ctrl-c'])
    expect(triggerSelection).toHaveBeenCalledTimes(1)
  })

  it('moves a row down through visible touch controls', () => {
    const onReorder = vi.fn<(keys: string[]) => void>()
    act(() => {
      renderer = renderList(onReorder)
    })

    const buttons = renderer!.root.findAllByType(Pressable)
    act(() => {
      buttons[3]!.props.onPress()
    })

    expect(onReorder).toHaveBeenCalledWith(['escape', 'ctrl-c', 'tab'])
    expect(triggerSelection).toHaveBeenCalledTimes(1)
  })

  it('marks the first up and last down controls disabled', () => {
    act(() => {
      renderer = renderList()
    })

    const buttons = renderer!.root.findAllByType(Pressable)
    expect(buttons[0]!.props.disabled).toBe(true)
    expect(buttons[0]!.props.accessibilityState).toEqual({ disabled: true })
    expect(buttons[5]!.props.disabled).toBe(true)
    expect(buttons[5]!.props.accessibilityState).toEqual({ disabled: true })
    expect(buttons[1]!.props.accessibilityState).toEqual({ disabled: false })
  })

  it('uses the latest item props for subsequent moves', () => {
    const onReorder = vi.fn<(keys: string[]) => void>()
    act(() => {
      renderer = renderList(onReorder)
    })
    act(() => {
      renderer!.root.findAllByType(Pressable)[2]!.props.onPress()
    })
    expect(onReorder).toHaveBeenLastCalledWith(['tab', 'escape', 'ctrl-c'])

    const reorderedItems = [items[1]!, items[0]!, items[2]!]
    act(() => {
      renderer!.update(
        createElement(DragReorderList<Item>, {
          items: reorderedItems,
          itemKey: (item) => item.id,
          onReorder,
          renderRow: (item) => createElement(Text, null, item.label),
          rowHeight: 56,
          scrollContentHeight: { value: 0 },
          scrollOffsetY: { value: 0 },
          scrollRef: {}
        })
      )
    })
    act(() => {
      renderer!.root.findAllByType(Pressable)[4]!.props.onPress()
    })

    expect(onReorder).toHaveBeenLastCalledWith(['tab', 'ctrl-c', 'escape'])
  })

  it('does not construct unsupported Harmony gesture or frame callbacks', () => {
    expect(harmonySource).not.toContain('Gesture.')
    expect(harmonySource).not.toContain('useFrameCallback')
    expect(harmonySource).not.toContain('PlatformSafeGestureDetector')
  })

  it('uses Harmony-specific shortcut settings copy for the visible controls', () => {
    expect(settingsSource).toContain("(Platform.OS as string) === 'harmony'")
    expect(settingsSource).toContain('use up/down controls')
    expect(settingsSource).toContain('drag the grip')
  })

  it('uses non-overlapping touch targets that do not squeeze narrow rows', () => {
    expect(harmonySource).toContain("flexDirection: 'row'")
    expect(harmonySource).toContain('flexShrink: 0')
    expect(harmonySource).toContain('minWidth: 0')
    expect(harmonySource).toContain('width: 44')
    expect(harmonySource).toContain('height: 44')
    expect(harmonySource).not.toContain('hitSlop')
  })
})
