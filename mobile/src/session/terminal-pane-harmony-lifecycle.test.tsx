import { createElement } from 'react'
import { Platform } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import { TerminalPaneView } from './TerminalPaneView'

const terminalWebViewMock = vi.hoisted(() => ({
  handle: {} as TerminalWebViewHandle
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'harmony' },
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles
  },
  View: 'View'
}))

vi.mock('../terminal/TerminalWebView', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    TerminalWebView: React.forwardRef<TerminalWebViewHandle, Record<string, unknown>>(
      function MockTerminalWebView(props, ref) {
        React.useImperativeHandle(ref, () => terminalWebViewMock.handle, [])
        return React.createElement('TerminalWebView', props)
      }
    )
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

function pane(active: boolean, covered = false) {
  return createElement(TerminalPaneView, {
    ...callbacks,
    active,
    covered,
    handle: 'term-1',
    keyboardLift: 0,
    textScale: 1
  })
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

describe('TerminalPaneView Harmony lifecycle', () => {
  it('keeps at most the active Harmony ArkWeb mounted', () => {
    act(() => {
      renderer = create(pane(false))
    })
    expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(0)

    act(() => {
      renderer?.update(pane(true))
    })
    expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(1)
    expect(callbacks.onRef).toHaveBeenLastCalledWith('term-1', terminalWebViewMock.handle)

    act(() => {
      renderer?.update(pane(false))
    })
    expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(0)
    expect(callbacks.onRef).toHaveBeenLastCalledWith('term-1', null)
  })

  it('does not create ArkWeb under native chat and activates it when uncovered', () => {
    act(() => {
      renderer = create(pane(true, true))
    })
    expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(0)

    act(() => {
      renderer?.update(pane(true, false))
    })
    expect(renderer?.root.findByType('TerminalWebView').props.active).toBe(true)
    expect(callbacks.onRef).toHaveBeenLastCalledWith('term-1', terminalWebViewMock.handle)

    act(() => {
      renderer?.update(pane(true, true))
    })
    expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(0)
    expect(callbacks.onRef).toHaveBeenLastCalledWith('term-1', null)
  })

  it('keeps inactive terminal WebViews mounted and attached on iOS', () => {
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'ios'
    try {
      act(() => {
        renderer = create(pane(true))
      })
      expect(callbacks.onRef).toHaveBeenLastCalledWith('term-1', terminalWebViewMock.handle)
      callbacks.onRef.mockClear()

      act(() => {
        renderer?.update(pane(false))
      })
      expect(renderer?.root.findAllByType('TerminalWebView')).toHaveLength(1)
      expect(renderer?.root.findByType('TerminalWebView').props.active).toBe(false)
      expect(callbacks.onRef).not.toHaveBeenCalledWith('term-1', null)
    } finally {
      mutablePlatform.OS = 'harmony'
    }
  })
})
