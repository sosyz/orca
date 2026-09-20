import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from './mobile-session-route-types'
import { resolveRetainedSessionSurfaceIds } from './retained-session-surface-order'
import { RetainedTerminalPaneHost } from './RetainedTerminalPaneHost'

vi.mock('react-native', () => ({
  View: 'View'
}))

const terminalPaneLifecycle = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>()
}))

vi.mock('./TerminalPaneView', async () => {
  const React = await import('react')
  return {
    TerminalPaneView: (props: Record<string, unknown>) => {
      React.useEffect(() => {
        const handle = String(props.handle)
        terminalPaneLifecycle.mounts.set(
          handle,
          (terminalPaneLifecycle.mounts.get(handle) ?? 0) + 1
        )
        return () => {
          terminalPaneLifecycle.unmounts.set(
            handle,
            (terminalPaneLifecycle.unmounts.get(handle) ?? 0) + 1
          )
        }
      }, [props.handle])
      return createElement('TerminalPaneView', props)
    }
  }
})

const callbacks = {
  onFileTap: vi.fn(),
  onHaptic: vi.fn(),
  onKeyboardAvoidanceMetrics: vi.fn(),
  onModesChanged: vi.fn(),
  onOpenUrl: vi.fn(),
  onRef: vi.fn(),
  onSelectionCopy: vi.fn(),
  onSelectionEvicted: vi.fn(),
  onSelectionMode: vi.fn(),
  onTerminalInput: vi.fn(),
  onTerminalQueryReply: vi.fn(),
  onTerminalTap: vi.fn(),
  onTextScaleChange: vi.fn(),
  onWebReady: vi.fn()
}

const frameStyle = { flex: 1 }
const hiddenFrameStyle = { display: 'none' as const }

function terminal(handle: string): Terminal {
  return {
    handle,
    isActive: false,
    title: handle
  }
}

function host({
  activeHandle,
  covered = false,
  keyboardLift = 0,
  terminals,
  visible,
  withOverlay = true
}: {
  activeHandle: string | null
  covered?: boolean
  keyboardLift?: number
  terminals: readonly Terminal[]
  visible: boolean
  withOverlay?: boolean
}) {
  return createElement(
    RetainedTerminalPaneHost,
    {
      ...callbacks,
      activeHandle,
      covered,
      frameStyle,
      hiddenFrameStyle,
      keyboardLift,
      terminals,
      textScale: 1,
      visible
    },
    withOverlay ? createElement('Overlay') : null
  )
}

function terminalPanes(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('TerminalPaneView')
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  terminalPaneLifecycle.mounts.clear()
  terminalPaneLifecycle.unmounts.clear()
  vi.clearAllMocks()
})

describe('RetainedTerminalPaneHost', () => {
  it('keeps every visited open terminal handle and prunes only closed handles', () => {
    const open = new Set(['a', 'b', 'c', 'd'])
    const afterA = resolveRetainedSessionSurfaceIds({
      activeId: 'a',
      liveIds: open,
      previousIds: []
    })
    const afterB = resolveRetainedSessionSurfaceIds({
      activeId: 'b',
      liveIds: open,
      previousIds: afterA
    })
    const afterD = resolveRetainedSessionSurfaceIds({
      activeId: 'd',
      liveIds: open,
      previousIds: afterB
    })

    expect(afterD).toEqual(['a', 'b', 'd'])
    expect(
      resolveRetainedSessionSurfaceIds({
        activeId: null,
        liveIds: new Set(['a', 'd']),
        previousIds: afterD
      })
    ).toEqual(['a', 'd'])
  })

  it('retains more than three visited terminal panes while they remain open', () => {
    const terminals = ['a', 'b', 'c', 'd'].map(terminal)
    act(() => {
      renderer = create(host({ activeHandle: 'a', terminals, visible: true }))
    })
    for (const handle of ['b', 'c', 'd']) {
      act(() => {
        renderer?.update(host({ activeHandle: handle, terminals, visible: true }))
      })
    }

    expect(terminalPanes(renderer!)).toHaveLength(4)
    expect(terminalPanes(renderer!).map((pane) => pane.props.handle)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('hides retained panes without activating them or showing terminal-only chrome', () => {
    const terminals = ['a', 'b'].map(terminal)
    act(() => {
      renderer = create(
        host({ activeHandle: 'a', covered: true, keyboardLift: 42, terminals, visible: true })
      )
    })
    act(() => {
      renderer?.update(host({ activeHandle: 'b', terminals, visible: true }))
    })

    expect(terminalPanes(renderer!).map((pane) => [pane.props.handle, pane.props.active])).toEqual([
      ['a', false],
      ['b', true]
    ])
    expect(renderer!.root.findAllByType('Overlay')).toHaveLength(1)

    act(() => {
      renderer?.update(host({ activeHandle: null, terminals, visible: false }))
    })

    expect(renderer!.root.findByType('View').props.pointerEvents).toBe('none')
    expect(terminalPanes(renderer!).map((pane) => pane.props.active)).toEqual([false, false])
    expect(terminalPanes(renderer!).map((pane) => pane.props.covered)).toEqual([false, false])
    expect(terminalPanes(renderer!).map((pane) => pane.props.keyboardLift)).toEqual([0, 0])
    expect(renderer!.root.findAllByType('Overlay')).toHaveLength(0)
  })

  it('re-activates an already retained pane without dropping the other visited pane', () => {
    const terminals = ['a', 'b'].map(terminal)
    act(() => {
      renderer = create(host({ activeHandle: 'a', terminals, visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeHandle: 'b', terminals, visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeHandle: 'a', terminals, visible: true }))
    })

    expect(terminalPanes(renderer!).map((pane) => [pane.props.handle, pane.props.active])).toEqual([
      ['a', true],
      ['b', false]
    ])
  })

  it('marks an overlay-covered active pane covered and restores it without remounting', () => {
    const terminals = [terminal('a')]
    act(() => {
      renderer = create(host({ activeHandle: 'a', terminals, visible: true }))
    })
    expect(terminalPanes(renderer!)[0].props).toMatchObject({ active: true, covered: false })

    act(() => {
      renderer?.update(host({ activeHandle: 'a', covered: true, terminals, visible: true }))
    })
    expect(terminalPanes(renderer!)[0].props).toMatchObject({ active: true, covered: true })

    act(() => {
      renderer?.update(host({ activeHandle: 'a', covered: false, terminals, visible: true }))
    })
    expect(terminalPanes(renderer!)[0].props).toMatchObject({ active: true, covered: false })
    expect(terminalPaneLifecycle.mounts.get('a')).toBe(1)
    expect(terminalPaneLifecycle.unmounts.get('a')).toBeUndefined()
  })

  it('switches active panes without remounting retained native children', () => {
    const terminals = ['a', 'b'].map(terminal)
    act(() => {
      renderer = create(host({ activeHandle: 'a', terminals, visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeHandle: 'b', terminals, visible: true }))
    })

    expect(terminalPaneLifecycle.mounts.get('a')).toBe(1)
    expect(terminalPaneLifecycle.mounts.get('b')).toBe(1)

    act(() => {
      renderer?.update(host({ activeHandle: 'a', terminals, visible: true }))
    })

    expect(terminalPaneLifecycle.mounts.get('a')).toBe(1)
    expect(terminalPaneLifecycle.mounts.get('b')).toBe(1)
    expect(terminalPaneLifecycle.unmounts.size).toBe(0)

    act(() => {
      renderer?.update(host({ activeHandle: 'a', terminals: [terminal('a')], visible: true }))
    })

    expect(terminalPaneLifecycle.unmounts.get('a')).toBeUndefined()
    expect(terminalPaneLifecycle.unmounts.get('b')).toBe(1)
  })
})
