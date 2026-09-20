import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import { RetainedSessionBrowserSurfaces } from './RetainedSessionBrowserSurfaces'

vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children?: unknown }) => createElement('View', props, children)
}))

const lifecycle = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>()
}))

vi.mock('../browser/MobileBrowserPane', async () => {
  const React = await import('react')
  return {
    MobileBrowserPane: (props: Record<string, unknown>) => {
      const id = String((props.tab as { id: string }).id)
      React.useEffect(() => {
        lifecycle.mounts.set(id, (lifecycle.mounts.get(id) ?? 0) + 1)
        return () => {
          lifecycle.unmounts.set(id, (lifecycle.unmounts.get(id) ?? 0) + 1)
        }
      }, [id])
      return createElement('MobileBrowserPane', props)
    }
  }
})

function browserTab(id: string): Extract<MobileSessionTab, { type: 'browser' }> {
  return {
    type: 'browser',
    browserPageId: `page-${id}`,
    browserWorkspaceId: 'browser-workspace',
    canGoBack: false,
    canGoForward: false,
    id,
    isActive: false,
    loading: false,
    title: id,
    url: 'https://example.test'
  }
}

function host(activeTab: Extract<MobileSessionTab, { type: 'browser' }> | null) {
  const tabs = ['a', 'b'].map(browserTab)
  return createElement(RetainedSessionBrowserSurfaces, {
    activeTab,
    bottomInset: 0,
    client: null,
    frameStyle: { flex: 1 },
    hiddenFrameStyle: { display: 'none' },
    keyboardLift: 0,
    onToast: vi.fn(),
    pairedHostId: 'host-1',
    screencastSupported: true,
    tabs,
    toast: createElement('Toast'),
    worktreeId: 'worktree-1'
  })
}

function panes(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('MobileBrowserPane')
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  lifecycle.mounts.clear()
  lifecycle.unmounts.clear()
  vi.clearAllMocks()
})

describe('RetainedSessionBrowserSurfaces', () => {
  it('keeps visited browser panes mounted and passes foreground activity', () => {
    const first = browserTab('a')
    const second = browserTab('b')
    act(() => {
      renderer = create(host(first))
    })
    act(() => {
      renderer?.update(host(second))
    })

    expect(panes(renderer!).map((pane) => [pane.props.tab.id, pane.props.active])).toEqual([
      ['a', false],
      ['b', true]
    ])
    expect(lifecycle.mounts.get('a')).toBe(1)
    expect(lifecycle.mounts.get('b')).toBe(1)

    act(() => {
      renderer?.update(host(first))
    })

    expect(panes(renderer!).map((pane) => [pane.props.tab.id, pane.props.active])).toEqual([
      ['a', true],
      ['b', false]
    ])
    expect(lifecycle.mounts.get('a')).toBe(1)
    expect(lifecycle.mounts.get('b')).toBe(1)
    expect(lifecycle.unmounts.size).toBe(0)
  })
})
