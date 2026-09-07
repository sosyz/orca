import { createElement, createRef } from 'react'
import { Platform } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const addEventListener = vi.fn((_eventName: 'change', listener: Listener) => {
    listeners.add(listener)
    return {
      remove: vi.fn(() => {
        listeners.delete(listener)
      })
    }
  })
  return {
    addEventListener,
    emit(nextState: 'active' | 'background' | 'inactive') {
      currentState = nextState
      for (const listener of Array.from(listeners)) {
        listener(nextState)
      }
    },
    get currentState() {
      return currentState
    },
    listenerCount() {
      return listeners.size
    },
    reset() {
      currentState = 'active'
      listeners.clear()
      addEventListener.mockClear()
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

// Why: mounting TerminalWebView arms the web-ready watchdog; tests must
// unmount so the timer can't survive into later tests and fire in teardown.
let activeRenderer: ReactTestRenderer | null = null

function createTerminalWebViewRenderer(
  onEngineError = vi.fn(),
  props: Record<string, unknown> = {}
) {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(TerminalWebView, { onEngineError, ...props }))
  })
  if (!renderer) {
    throw new Error('TerminalWebView did not render')
  }
  activeRenderer = renderer
  return { onEngineError, renderer }
}

function postWebViewMessage(renderer: ReactTestRenderer, payload: Record<string, unknown>) {
  const webView = renderer.root.findByType('WebView')
  act(() => {
    webView.props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } })
  })
}

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.props.children)
    .join(' ')
}

function postedCommands(): Array<Record<string, unknown>> {
  return nativeWebViewMethods.postMessage.mock.calls.map(([message]) => JSON.parse(message))
}

describe('TerminalWebView engine errors', () => {
  afterEach(() => {
    if (activeRenderer) {
      act(() => {
        activeRenderer?.unmount()
      })
      activeRenderer = null
    }
    appStateMock.reset()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it.each([
    ['onError', 'Terminal WebView load failed'],
    ['onHttpError', 'Terminal WebView HTTP error'],
    ['onRenderProcessGone', 'Terminal WebView render process ended']
  ])('reports %s as a fatal native WebView error', (callbackName, context) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onEngineError, renderer } = createTerminalWebViewRenderer()

    act(() => {
      renderer.root.findByType('WebView').props[callbackName]({
        nativeEvent: {
          code: 7,
          description: 'native failure',
          didCrash: true,
          domain: 'WebView'
        }
      })
    })

    expect(onEngineError).toHaveBeenCalledWith(
      `${context} - native failure - code 7 - WebView - renderer crashed`
    )
    expect(renderedText(renderer)).toContain('Terminal failed to load')
    expect(renderedText(renderer)).toContain(context)
    expect(renderedText(renderer)).toContain('native failure')
  })

  it('renders the reload overlay for fatal engine errors from the WebView', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onEngineError, renderer } = createTerminalWebViewRenderer()

    postWebViewMessage(renderer, {
      fatal: true,
      message: 'terminal engine missing - SyntaxError - Chrome 74',
      type: 'error'
    })

    expect(onEngineError).toHaveBeenCalledWith('terminal engine missing - SyntaxError - Chrome 74')
    expect(renderedText(renderer)).toContain('Terminal failed to load')
    expect(renderedText(renderer)).toContain('terminal engine missing - SyntaxError - Chrome 74')
    expect(renderedText(renderer)).toContain('Reload')
  })

  it('reports non-fatal engine errors without covering a live terminal', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onEngineError, renderer } = createTerminalWebViewRenderer()

    postWebViewMessage(renderer, {
      fatal: false,
      message: 'terminal message failed - malformed chunk',
      type: 'error'
    })

    expect(onEngineError).toHaveBeenCalledWith('terminal message failed - malformed chunk')
    expect(renderedText(renderer)).not.toContain('Terminal failed to load')
  })

  it('keeps the first fatal diagnostics when later fatal reports cascade', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { renderer } = createTerminalWebViewRenderer()

    postWebViewMessage(renderer, {
      fatal: true,
      message: 'terminal engine missing - root cause',
      type: 'error'
    })
    postWebViewMessage(renderer, {
      fatal: true,
      message: 'Terminal did not initialize - watchdog cascade',
      type: 'error'
    })

    expect(renderedText(renderer)).toContain('terminal engine missing - root cause')
    expect(renderedText(renderer)).not.toContain('watchdog cascade')
  })

  // Why: if the document dies before the glue can post anything (or the RN
  // bridge never comes up), no message and no native error handler fires —
  // the watchdog must convert that silence into the visible fatal overlay.
  it('paints the fatal overlay when web-ready never arrives', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { onEngineError, renderer } = createTerminalWebViewRenderer()

      act(() => {
        vi.advanceTimersByTime(15000)
      })

      expect(onEngineError).toHaveBeenCalledWith(
        'Terminal did not initialize - no ready signal from the terminal view'
      )
      expect(renderedText(renderer)).toContain('Terminal failed to load')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the watchdog once web-ready has arrived', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { onEngineError, renderer } = createTerminalWebViewRenderer()

      postWebViewMessage(renderer, { type: 'web-ready' })
      act(() => {
        vi.advanceTimersByTime(60000)
      })

      expect(onEngineError).not.toHaveBeenCalled()
      expect(renderedText(renderer)).not.toContain('Terminal failed to load')
    } finally {
      vi.useRealTimers()
    }
  })

  it('recreates Harmony ArkWeb once when its RN bridge never attaches', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    try {
      const { onEngineError, renderer } = createTerminalWebViewRenderer()
      const firstWebView = renderer.root.findByType('WebView')

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      const recoveredWebView = renderer.root.findByType('WebView')
      expect(recoveredWebView).not.toBe(firstWebView)
      expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
      expect(onEngineError).not.toHaveBeenCalled()

      act(() => {
        recoveredWebView.props.onLoadStart()
      })
      postWebViewMessage(renderer, { bridgeId: 'recovered-document', type: 'bridge-ready' })
      postWebViewMessage(renderer, { type: 'web-ready' })
      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(onEngineError).not.toHaveBeenCalled()
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('does not spend the Harmony bridge recovery attempt while backgrounded', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    appStateMock.currentState = 'background'
    try {
      const { renderer } = createTerminalWebViewRenderer()
      const backgroundWebView = renderer.root.findByType('WebView')

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(renderer.root.findByType('WebView')).toBe(backgroundWebView)

      act(() => {
        appStateMock.emit('active')
      })
      act(() => {
        vi.advanceTimersByTime(4999)
      })
      expect(renderer.root.findByType('WebView')).toBe(backgroundWebView)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(renderer.root.findByType('WebView')).not.toBe(backgroundWebView)
      expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('checks AppState again before spending the Harmony bridge recovery attempt', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    try {
      const { renderer } = createTerminalWebViewRenderer()
      const firstWebView = renderer.root.findByType('WebView')

      act(() => {
        appStateMock.emit('background')
        vi.advanceTimersByTime(5000)
      })
      expect(renderer.root.findByType('WebView')).toBe(firstWebView)

      act(() => {
        appStateMock.emit('active')
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(renderer.root.findByType('WebView')).not.toBe(firstWebView)
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('clears the Harmony bridge recovery timer on unmount', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    try {
      const { renderer } = createTerminalWebViewRenderer()
      expect(appStateMock.listenerCount()).toBe(1)

      act(() => {
        renderer.unmount()
      })
      activeRenderer = null
      expect(appStateMock.listenerCount()).toBe(0)

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('does not use the Harmony bridge remount timer on iOS or Android', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    try {
      for (const platform of ['ios', 'android']) {
        mutablePlatform.OS = platform
        const { renderer } = createTerminalWebViewRenderer()
        const webView = renderer.root.findByType('WebView')

        act(() => {
          vi.advanceTimersByTime(5000)
        })
        expect(renderer.root.findByType('WebView')).toBe(webView)
        expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()

        act(() => {
          renderer.unmount()
        })
        activeRenderer = null
      }
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('lets a manual Harmony reload reset the bounded bridge recovery attempt', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    try {
      const { renderer } = createTerminalWebViewRenderer()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      const autoRecoveredWebView = renderer.root.findByType('WebView')

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(renderer.root.findByType('WebView')).toBe(autoRecoveredWebView)

      postWebViewMessage(renderer, { fatal: true, message: 'bridge missing', type: 'error' })
      act(() => {
        renderer.root.findByType('Pressable').props.onPress()
      })
      const manualReloadWebView = renderer.root.findByType('WebView')
      expect(manualReloadWebView).not.toBe(autoRecoveredWebView)

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(renderer.root.findByType('WebView')).not.toBe(manualReloadWebView)
    } finally {
      mutablePlatform.OS = 'ios'
      vi.useRealTimers()
    }
  })

  it('acknowledges a Harmony bridge before accepting web readiness', () => {
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    try {
      const onWebReady = vi.fn()
      const { renderer } = createTerminalWebViewRenderer(vi.fn(), { onWebReady })
      nativeWebViewMethods.postMessage.mockClear()

      postWebViewMessage(renderer, { bridgeId: 'current-document', type: 'bridge-ready' })
      expect(postedCommands()).toEqual([
        expect.objectContaining({ bridgeId: 'current-document', type: 'bridge-ack' })
      ])

      postWebViewMessage(renderer, { type: 'web-ready' })
      postWebViewMessage(renderer, { type: 'web-ready' })
      expect(onWebReady).toHaveBeenCalledTimes(1)
    } finally {
      mutablePlatform.OS = 'ios'
    }
  })

  it('defers hidden-pane watchdogs without an eager activation reload', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const onEngineError = vi.fn()
      const { renderer } = createTerminalWebViewRenderer(onEngineError, { active: false })

      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(onEngineError).not.toHaveBeenCalled()
      expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()

      act(() => {
        renderer.update(createElement(TerminalWebView, { active: true, onEngineError }))
      })
      expect(nativeWebViewMethods.reload).not.toHaveBeenCalled()

      postWebViewMessage(renderer, { type: 'web-ready' })
      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(onEngineError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues iOS foreground traffic until the current document answers its ping', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const onWebReady = vi.fn()
    const terminalTheme = {
      mode: 'dark',
      theme: { background: '#111111', foreground: '#eeeeee' }
    }
    const { renderer } = createTerminalWebViewRenderer(vi.fn(), {
      ref: terminalRef,
      onWebReady,
      terminalTheme
    })
    postWebViewMessage(renderer, { type: 'web-ready' })
    nativeWebViewMethods.postMessage.mockClear()

    act(() => {
      terminalRef.current?.prepareForForegroundRecovery()
      terminalRef.current?.write('queued output')
    })

    const ping = postedCommands()[0]
    expect(postedCommands().map((command) => command.type)).toEqual(['ping'])
    postWebViewMessage(renderer, { type: 'pong', pingId: Number(ping?.id) + 1 })
    expect(postedCommands().map((command) => command.type)).toEqual(['ping'])

    postWebViewMessage(renderer, { type: 'pong', pingId: ping?.id })
    expect(postedCommands().map((command) => command.type)).toEqual(['ping', 'set-theme', 'write'])
    expect(onWebReady).toHaveBeenCalledTimes(1)
  })

  it('keeps Android foreground traffic on the existing ready document', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'android'
    const { renderer } = createTerminalWebViewRenderer(vi.fn(), { ref: terminalRef })
    postWebViewMessage(renderer, { type: 'web-ready' })
    nativeWebViewMethods.postMessage.mockClear()
    try {
      act(() => {
        terminalRef.current?.prepareForForegroundRecovery()
        terminalRef.current?.write('android output')
      })
      expect(postedCommands().map((command) => command.type)).toEqual(['write'])
    } finally {
      mutablePlatform.OS = 'ios'
    }
  })

  it('keeps Harmony terminal initialization on the DOM renderer', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const mutablePlatform = Platform as { OS: string }
    mutablePlatform.OS = 'harmony'
    const { renderer } = createTerminalWebViewRenderer(vi.fn(), { ref: terminalRef })
    postWebViewMessage(renderer, { type: 'web-ready' })
    nativeWebViewMethods.postMessage.mockClear()
    try {
      act(() => {
        terminalRef.current?.init(80, 24, 'prompt')
      })
      expect(postedCommands()).toEqual([
        expect.objectContaining({ type: 'init', enableWebgl: false })
      ])
    } finally {
      mutablePlatform.OS = 'ios'
    }
  })

  it('reloads a terminated iOS content process and restores theme on readiness', () => {
    const terminalRef = createRef<TerminalWebViewHandle>()
    const { onEngineError, renderer } = createTerminalWebViewRenderer(vi.fn(), {
      ref: terminalRef,
      terminalTheme: {
        mode: 'light',
        theme: { background: '#ffffff', foreground: '#111111' }
      }
    })
    postWebViewMessage(renderer, { type: 'web-ready' })
    nativeWebViewMethods.postMessage.mockClear()
    const webView = renderer.root.findByType('WebView')

    act(() => {
      webView.props.onContentProcessDidTerminate({ nativeEvent: {} })
      terminalRef.current?.write('after termination')
    })

    expect(nativeWebViewMethods.reload).toHaveBeenCalledTimes(1)
    expect(nativeWebViewMethods.postMessage).not.toHaveBeenCalled()
    expect(onEngineError).not.toHaveBeenCalled()

    postWebViewMessage(renderer, { type: 'web-ready' })
    expect(postedCommands().map((command) => command.type)).toEqual(['set-theme', 'write'])
  })
})
