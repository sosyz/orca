import type { RefObject } from 'react'
import type { TerminalWebViewCommand } from './terminal-webview-messages'

export type TerminalFitDimensions = { cols: number; rows: number }

type TerminalWebViewMeasurementOptions = {
  containerHeight?: number
  isWebReadyRef: RefObject<boolean>
  measureResolveRef: RefObject<((result: TerminalFitDimensions | null) => void) | null>
  sendToWebView: (msg: TerminalWebViewCommand) => number
}

export function measureTerminalFitDimensions({
  containerHeight,
  isWebReadyRef,
  measureResolveRef,
  sendToWebView
}: TerminalWebViewMeasurementOptions): Promise<TerminalFitDimensions | null> {
  if (!isWebReadyRef.current) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    measureResolveRef.current?.(null)
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (result: TerminalFitDimensions | null) => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (measureResolveRef.current === finish) {
        measureResolveRef.current = null
      }
      resolve(result)
    }
    measureResolveRef.current = finish
    sendToWebView({ type: 'measure', containerHeight })
    // Why: if the WebView doesn't respond within 2s, resolve null so the caller
    // can disable Fit to Phone rather than hanging indefinitely.
    timeout = setTimeout(() => {
      if (measureResolveRef.current === finish) {
        finish(null)
      }
    }, 2000)
  })
}
