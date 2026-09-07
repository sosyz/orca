// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

function iifeSource(): string {
  const start = XTERM_HTML.indexOf('(function() {')
  const end = XTERM_HTML.lastIndexOf('})();')
  return XTERM_HTML.slice(start, end + '})();'.length)
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

describe('terminal WebView Harmony bridge readiness', () => {
  afterEach(() => {
    const webWindow = window as unknown as {
      ReactNativeWebView?: unknown
      __ORCA_HARMONY_WEBVIEW__?: boolean
    }
    delete webWindow.ReactNativeWebView
    delete webWindow.__ORCA_HARMONY_WEBVIEW__
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('waits for a late ReactNativeWebView proxy before announcing readiness', async () => {
    vi.useFakeTimers()
    const posted: Array<Record<string, unknown>> = []
    const webWindow = window as unknown as {
      Terminal?: () => void
      ReactNativeWebView?: { postMessage(data: string): void }
      __ORCA_HARMONY_WEBVIEW__?: boolean
    }
    webWindow.Terminal = function Terminal() {}
    webWindow.__ORCA_HARMONY_WEBVIEW__ = true
    delete webWindow.ReactNativeWebView
    document.body.innerHTML = bodyMarkup()

    new Function(iifeSource())()
    vi.advanceTimersByTime(49)
    expect(posted).toEqual([])

    webWindow.ReactNativeWebView = {
      postMessage(data: string) {
        posted.push(JSON.parse(data) as Record<string, unknown>)
      }
    }
    await vi.advanceTimersByTimeAsync(1)

    expect(posted).toEqual([expect.objectContaining({ type: 'bridge-ready' })])
    const bridgeId = String(posted[0]?.bridgeId)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ bridgeId, id: 1, type: 'bridge-ack' })
      })
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(posted).toEqual([
      expect.objectContaining({ bridgeId, type: 'bridge-ready' }),
      { type: 'web-ready' }
    ])
    await vi.advanceTimersByTimeAsync(1000)
    expect(posted).toHaveLength(2)
  })

  it('retries when ArkWeb exposes a proxy whose native target is not ready', async () => {
    vi.useFakeTimers()
    const posted: Array<Record<string, unknown>> = []
    let attempts = 0
    const webWindow = window as unknown as {
      Terminal?: () => void
      ReactNativeWebView?: { postMessage(data: string): void }
      __ORCA_HARMONY_WEBVIEW__?: boolean
    }
    webWindow.Terminal = function Terminal() {}
    webWindow.__ORCA_HARMONY_WEBVIEW__ = true
    webWindow.ReactNativeWebView = {
      postMessage(data: string) {
        attempts += 1
        if (attempts < 3) {
          throw new Error('native proxy object not found')
        }
        posted.push(JSON.parse(data) as Record<string, unknown>)
      }
    }
    document.body.innerHTML = bodyMarkup()

    expect(() => new Function(iifeSource())()).not.toThrow()
    await vi.advanceTimersByTimeAsync(100)

    expect(attempts).toBe(3)
    expect(posted).toEqual([expect.objectContaining({ type: 'bridge-ready' })])
    const bridgeId = String(posted[0]?.bridgeId)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ bridgeId: 'stale-document', id: 2, type: 'bridge-ack' })
      })
    )
    await vi.advanceTimersByTimeAsync(50)
    expect(posted.every((message) => message.type === 'bridge-ready')).toBe(true)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ bridgeId, id: 3, type: 'bridge-ack' })
      })
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(posted.at(-1)).toEqual({ type: 'web-ready' })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ bridgeId, id: 4, type: 'bridge-ack' })
      })
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(posted.filter((message) => message.type === 'web-ready')).toHaveLength(1)
  })
})
