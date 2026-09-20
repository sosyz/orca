import { createElement, createRef, type MutableRefObject } from 'react'
import { Platform } from 'react-native'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTerminalWebViewRegistration } from '../session/terminal-webview-registration'
import { TerminalWebView } from './TerminalWebView'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

const nativeWebViewMethods = vi.hoisted(() => ({
  postMessage: vi.fn<(message: string) => void>(),
  reload: vi.fn<() => void>()
}))

const appStateMock = vi.hoisted(() => {
  type Listener = (state: 'active' | 'background' | 'inactive') => void
  let currentState: 'active' | 'background' | 'inactive' = 'active'
  const listeners = new Set<Listener>()
  return {
    addEventListener: vi.fn((_eventName: 'change', listener: Listener) => {
      listeners.add(listener)
      return {
        remove: vi.fn(() => {
          listeners.delete(listener)
        })
      }
    }),
    get currentState() {
      return currentState
    },
    reset() {
      currentState = 'active'
      listeners.clear()
    },
    set currentState(nextState: 'active' | 'background' | 'inactive') {
      currentState = nextState
    }
  }
})

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: appStateMock.addEventListener,
    get currentState() {
      return appStateMock.currentState
    }
  },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0
    },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => nativeWebViewMethods)
    return React.createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw'
}))

let renderer: ReactTestRenderer | null = null
const HANDLE = 'terminal-1'

function mutableRef<T>(current: T): MutableRefObject<T> {
  return { current }
}

function registrationHarness() {
  const refs = {
    initializedHandlesRef: mutableRef(new Set<string>()),
    leaseOnlyHandlesRef: mutableRef(new Set<string>()),
    subscribingHandlesRef: mutableRef(new Set<string>()),
    terminalGestureInputBucketsRef: mutableRef(new Map()),
    terminalGestureInputInFlightRef: mutableRef(new Set<string>()),
    terminalGestureInputQueuesRef: mutableRef(new Map()),
    terminalRenderedHandlesRef: mutableRef(new Set<string>()),
    terminalRefs: mutableRef(new Map<string, TerminalWebViewHandle>()),
    terminalUnsubsRef: mutableRef(new Map<string, () => void>()),
    unsubscribeTerminal: vi.fn((handle: string) => {
      refs.terminalUnsubsRef.current.get(handle)?.()
      refs.terminalUnsubsRef.current.delete(handle)
      refs.subscribingHandlesRef.current.delete(handle)
      refs.leaseOnlyHandlesRef.current.delete(handle)
    }),
    webReadyHandlesRef: mutableRef(new Set<string>())
  }
  const onRef = vi.fn((ref: TerminalWebViewHandle | null) => {
    setTerminalWebViewRegistration(refs, HANDLE, ref)
  })
  return { onRef, refs }
}

function renderTerminalWebView(props: Record<string, unknown> = {}): ReactTestRenderer {
  let nextRenderer: ReactTestRenderer | null = null
  act(() => {
    nextRenderer = create(createElement(TerminalWebView, props))
  })
  if (!nextRenderer) {
    throw new Error('TerminalWebView did not render')
  }
  renderer = nextRenderer
  return nextRenderer
}

function postWebViewMessage(webView: ReactTestInstance, payload: Record<string, unknown>) {
  webView.props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } })
}

function postedCommands(): Array<Record<string, unknown>> {
  return nativeWebViewMethods.postMessage.mock.calls.map(([message]) => JSON.parse(message))
}

describe('TerminalWebView foreground remount recovery', () => {
  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount())
      renderer = null
    }
    appStateMock.reset()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    ;(Platform as { OS: string }).OS = 'ios'
  })

  it('ignores an older measurement reply after a newer viewport request starts', async () => {
    vi.useFakeTimers()
    const ref = createRef<TerminalWebViewHandle>()
    const view = renderTerminalWebView({ ref }).root.findByType('WebView')
    act(() => postWebViewMessage(view, { type: 'web-ready' }))
    const first = ref.current!.measureFitDimensions(640)
    const firstId = postedCommands().at(-1)!.id
    const second = ref.current!.measureFitDimensions(320)
    const secondId = postedCommands().at(-1)!.id
    await expect(first).resolves.toBeNull()
    const settled = vi.fn()
    void second.then(settled)
    act(() =>
      postWebViewMessage(view, { type: 'measure-result', measureId: firstId, cols: 80, rows: 40 })
    )
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    act(() =>
      postWebViewMessage(view, { type: 'measure-result', measureId: secondId, cols: 80, rows: 20 })
    )
    await expect(second).resolves.toEqual({ cols: 80, rows: 20 })
  })

  it.each([20.5, 1e100])('rejects invalid measurement dimensions %s', async (cols) => {
    const ref = createRef<TerminalWebViewHandle>()
    const view = renderTerminalWebView({ ref }).root.findByType('WebView')
    act(() => postWebViewMessage(view, { type: 'web-ready' }))
    const result = ref.current!.measureFitDimensions()
    const measureId = postedCommands().at(-1)!.id
    act(() => postWebViewMessage(view, { type: 'measure-result', measureId, cols, rows: 24 }))
    await expect(result).resolves.toBeNull()
  })

  it('remounts Harmony foreground recovery and rejects stale generation messages immediately', async () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const onTerminalQueryReply = vi.fn()
    const onWebReady = vi.fn()
    ;(Platform as { OS: string }).OS = 'harmony'
    const terminalRenderer = renderTerminalWebView({
      ref: terminalRef,
      onTerminalQueryReply,
      onWebReady
    })
    const firstWebView = terminalRenderer.root.findByType('WebView')
    act(() => {
      postWebViewMessage(firstWebView, { type: 'web-ready' })
    })
    expect(onWebReady).toHaveBeenCalledTimes(1)

    let measurePromise: Promise<{ cols: number; rows: number } | null> | null = null
    act(() => {
      measurePromise = terminalRef.current?.measureFitDimensions() ?? null
    })
    expect(postedCommands().map((command) => command.type)).toContain('measure')
    nativeWebViewMethods.postMessage.mockClear()

    act(() => {
      terminalRef.current?.prepareForForegroundRecovery()
      postWebViewMessage(firstWebView, {
        bridgeId: 'stale-bridge',
        type: 'bridge-ready'
      })
      postWebViewMessage(firstWebView, {
        bytes: '\x1b[3;4R',
        type: 'terminal-data'
      })
      postWebViewMessage(firstWebView, { type: 'web-ready' })
    })

    expect(terminalRenderer.root.findByType('WebView')).not.toBe(firstWebView)
    expect(onTerminalQueryReply).not.toHaveBeenCalled()
    expect(onWebReady).toHaveBeenCalledTimes(1)
    expect(postedCommands()).toEqual([])
    expect(measurePromise).not.toBeNull()
    await expect(measurePromise!).resolves.toBeNull()
    expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
  })

  it('keeps session registration attached when handle-only props change', () => {
    const { onRef, refs } = registrationHarness()
    const terminalRenderer = renderTerminalWebView({
      active: true,
      ref: onRef,
      terminalTheme: {
        mode: 'dark',
        theme: { background: '#111111', foreground: '#eeeeee' }
      },
      textScale: 1
    })
    const firstWebView = terminalRenderer.root.findByType('WebView')
    const firstHandle = refs.terminalRefs.current.get(HANDLE)
    const terminalUnsubscribe = vi.fn()
    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.initializedHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, terminalUnsubscribe)
    onRef.mockClear()

    act(() => {
      terminalRenderer.update(
        createElement(TerminalWebView, {
          active: false,
          ref: onRef,
          terminalTheme: {
            mode: 'light',
            theme: { background: '#ffffff', foreground: '#111111' }
          },
          textScale: 1.25
        })
      )
    })

    expect(terminalRenderer.root.findByType('WebView')).toBe(firstWebView)
    expect(onRef).not.toHaveBeenCalled()
    expect(refs.unsubscribeTerminal).not.toHaveBeenCalled()
    expect(terminalUnsubscribe).not.toHaveBeenCalled()
    expect(refs.terminalRefs.current.get(HANDLE)).toBe(firstHandle)
    expect(refs.terminalUnsubsRef.current.get(HANDLE)).toBe(terminalUnsubscribe)
  })

  it('releases session registration on an actual WebView unmount', () => {
    const { onRef, refs } = registrationHarness()
    const terminalRenderer = renderTerminalWebView({ ref: onRef })
    const terminalUnsubscribe = vi.fn()
    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.initializedHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, terminalUnsubscribe)
    onRef.mockClear()

    act(() => {
      terminalRenderer.unmount()
      renderer = null
    })

    expect(onRef).toHaveBeenCalledWith(null)
    expect(refs.unsubscribeTerminal).toHaveBeenCalledWith(HANDLE)
    expect(terminalUnsubscribe).toHaveBeenCalledTimes(1)
    expect(refs.terminalRefs.current.has(HANDLE)).toBe(false)
  })

  it('uses the latest theme and scale when the stable handle initializes', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const terminalRenderer = renderTerminalWebView({
      ref: terminalRef,
      terminalTheme: {
        mode: 'dark',
        theme: { background: '#111111', foreground: '#eeeeee' }
      },
      textScale: 1
    })
    const webView = terminalRenderer.root.findByType('WebView')
    act(() => {
      postWebViewMessage(webView, { type: 'web-ready' })
    })
    nativeWebViewMethods.postMessage.mockClear()

    const nextTheme = {
      mode: 'light',
      theme: { background: '#ffffff', foreground: '#111111' }
    }
    act(() => {
      terminalRenderer.update(
        createElement(TerminalWebView, {
          ref: terminalRef,
          terminalTheme: nextTheme,
          textScale: 1.35
        })
      )
    })
    nativeWebViewMethods.postMessage.mockClear()

    act(() => {
      terminalRef.current?.init(80, 24, 'prompt')
    })

    expect(postedCommands()).toEqual([
      expect.objectContaining({
        fontScale: 1.35,
        terminalTheme: nextTheme,
        type: 'init'
      })
    ])
  })

  it('drops pending init and write commands when Harmony remounts for foreground recovery', async () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    ;(Platform as { OS: string }).OS = 'harmony'
    const terminalRenderer = renderTerminalWebView({ ref: terminalRef })
    const firstWebView = terminalRenderer.root.findByType('WebView')

    let readyPromise: Promise<void> | null = null
    act(() => {
      terminalRef.current?.write('queued before remount')
      terminalRef.current?.init(80, 24, 'old prompt')
      readyPromise = terminalRef.current?.awaitReady() ?? null
      terminalRef.current?.prepareForForegroundRecovery()
    })

    expect(terminalRenderer.root.findByType('WebView')).not.toBe(firstWebView)
    expect(postedCommands()).toEqual([])
    expect(readyPromise).not.toBeNull()
    await expect(readyPromise!).resolves.toBeUndefined()

    const remountedWebView = terminalRenderer.root.findByType('WebView')
    act(() => {
      postWebViewMessage(remountedWebView, { type: 'web-ready' })
    })
    expect(postedCommands().map((command) => command.type)).toEqual(['set-theme'])
  })

  it('keeps a Harmony surface ready when load-start arrives after web-ready', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    ;(Platform as { OS: string }).OS = 'harmony'
    const terminalRenderer = renderTerminalWebView({ ref: terminalRef })
    const firstWebView = terminalRenderer.root.findByType('WebView')
    act(() => {
      terminalRef.current?.prepareForForegroundRecovery()
    })
    expect(terminalRenderer.root.findByType('WebView')).not.toBe(firstWebView)

    const remountedWebView = terminalRenderer.root.findByType('WebView')
    act(() => {
      postWebViewMessage(remountedWebView, { type: 'web-ready' })
      remountedWebView.props.onLoadStart()
      terminalRef.current?.write('after ready')
    })

    expect(postedCommands().map((command) => command.type)).toEqual(['set-theme', 'write'])
  })

  it('does not remount a hidden Harmony surface from the foreground prepare hook', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    ;(Platform as { OS: string }).OS = 'harmony'
    const terminalRenderer = renderTerminalWebView({
      active: false,
      ref: terminalRef
    })
    const firstWebView = terminalRenderer.root.findByType('WebView')

    act(() => {
      terminalRef.current?.prepareForForegroundRecovery()
    })

    expect(terminalRenderer.root.findByType('WebView')).toBe(firstWebView)
    expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
  })

  it('remounts Harmony when bridge-ready arrives but web-ready never follows', () => {
    vi.useFakeTimers()
    ;(Platform as { OS: string }).OS = 'harmony'
    const terminalRenderer = renderTerminalWebView()
    const firstWebView = terminalRenderer.root.findByType('WebView')

    act(() => {
      postWebViewMessage(firstWebView, {
        bridgeId: 'bridge-only',
        type: 'bridge-ready'
      })
    })
    expect(postedCommands()).toEqual([
      expect.objectContaining({ bridgeId: 'bridge-only', type: 'bridge-ack' })
    ])

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(terminalRenderer.root.findByType('WebView')).not.toBe(firstWebView)
    expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
  })
})
