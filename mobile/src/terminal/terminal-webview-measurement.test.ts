import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  measureTerminalFitDimensions,
  type TerminalMeasureResolver
} from './terminal-webview-measurement'

const htmlSource = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')
const measureSource = htmlSource.slice(
  htmlSource.indexOf('  function measureFitDimensions('),
  htmlSource.indexOf('  function handleMsg(')
)

afterEach(() => vi.useRealTimers())

describe('terminal viewport measurement lifecycle', () => {
  it('settles a bridge send failure and releases the timer and pending request', async () => {
    vi.useFakeTimers()
    const measureResolveRef = { current: null as TerminalMeasureResolver | null }
    const result = measureTerminalFitDimensions({
      isWebReadyRef: { current: true },
      measureResolveRef,
      sendToWebView: () => {
        throw new Error('WebView detached')
      }
    })
    await expect(result).resolves.toBeNull()
    expect(measureResolveRef.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps request identity through delayed engine readiness and failed measurement', () => {
    const callbacks: Array<() => void> = []
    const replies: unknown[] = []
    const term = {
      element: {},
      _core: { _renderService: { dimensions: { css: { cell: { width: 0, height: 0 } } } } }
    }
    const measure = new Function(
      'term',
      'window',
      'requestAnimationFrame',
      'notify',
      'flog',
      'MIN_FIT_COLS',
      `${measureSource}; return measureFitDimensions;`
    )(
      term,
      { innerWidth: 800, innerHeight: 600 },
      (callback: () => void) => callbacks.push(callback),
      (reply: unknown) => replies.push(reply),
      () => {},
      20
    )
    measure(400, 17)
    expect(replies).toEqual([])
    term._core._renderService.dimensions.css.cell = { width: 10, height: 20 }
    callbacks.shift()?.()
    expect(replies).toEqual([{ type: 'measure-result', measureId: 17, cols: 80, rows: 20 }])
    term._core._renderService.dimensions.css.cell = { width: 0, height: 0 }
    measure(400, 18, 0)
    expect(replies.at(-1)).toEqual({
      type: 'measure-result',
      measureId: 18,
      cols: null,
      rows: null
    })
  })
})
