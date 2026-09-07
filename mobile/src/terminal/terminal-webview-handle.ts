import { useImperativeHandle, useLayoutEffect, useRef, type Ref, type RefObject } from 'react'
import type { TerminalOscLinkRange } from '../../../src/shared/terminal-osc-link-ranges'
import type { MobileTerminalTheme, TerminalWebViewHandle } from './terminal-webview-contract'
import {
  measureTerminalFitDimensions,
  type TerminalFitDimensions
} from './terminal-webview-measurement'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import type { TerminalWebViewPlatformPolicy } from './terminal-webview-platform-policy'

type TerminalWriteCoalescerHandle = {
  clear: () => void
  flushNow: () => void
  write: (data: string) => void
}

type TerminalWebViewHandleOptions = {
  armWebReadyWatchdog: () => void
  active: boolean
  isWebReadyRef: RefObject<boolean>
  measureResolveRef: RefObject<((result: TerminalFitDimensions | null) => void) | null>
  pendingPingIdRef: RefObject<number | null>
  platformPolicy: TerminalWebViewPlatformPolicy
  postMessage: (msg: TerminalWebViewCommand) => void
  recoverWebViewSurface: () => void
  readyPromiseRef: RefObject<Promise<void> | null>
  readyResolveRef: RefObject<(() => void) | null>
  readyTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
  ref: Ref<TerminalWebViewHandle>
  sendToWebView: (msg: TerminalWebViewCommand) => number
  settleReady: () => void
  terminalTheme?: MobileTerminalTheme
  textScale: number
  writeCoalescer: TerminalWriteCoalescerHandle
}

export function useTerminalWebViewHandle(options: TerminalWebViewHandleOptions) {
  const { ref } = options
  const optionsRef = useRef(options)

  useLayoutEffect(() => {
    optionsRef.current = options
  })

  useImperativeHandle(
    ref,
    () => ({
      get foregroundRecovery() {
        return optionsRef.current.platformPolicy.foregroundRecovery
      },
      prepareForForegroundRecovery() {
        const current = optionsRef.current
        if (current.platformPolicy.foregroundRecovery === 'remount-surface') {
          if (current.active) {
            current.recoverWebViewSurface()
          }
          return
        }
        if (current.platformPolicy.foregroundRecovery !== 'probe-mounted-document') {
          return
        }
        // Why: only ping may bypass readiness; init/write wait for this document.
        current.isWebReadyRef.current = false
        current.armWebReadyWatchdog()
        current.pendingPingIdRef.current = current.sendToWebView({ type: 'ping' })
      },
      write(data: string) {
        optionsRef.current.writeCoalescer.write(data)
      },
      init(
        cols: number,
        rows: number,
        initialData?: string,
        preserveScroll?: boolean,
        oscLinks?: TerminalOscLinkRange[]
      ) {
        const current = optionsRef.current
        current.settleReady()
        current.readyPromiseRef.current = new Promise<void>((resolve) => {
          current.readyResolveRef.current = resolve
        })
        current.readyTimeoutRef.current = setTimeout(current.settleReady, 3000)
        // Why: init snapshot supersedes queued pre-init chunks.
        current.writeCoalescer.clear()
        current.postMessage({
          type: 'init',
          cols,
          rows,
          initialData,
          oscLinks,
          terminalTheme: current.terminalTheme,
          fontScale: current.textScale,
          enableWebgl: current.platformPolicy.webglEnabled,
          preserveScroll
        })
      },
      resize(cols: number, rows: number) {
        const current = optionsRef.current
        current.writeCoalescer.flushNow()
        current.postMessage({ type: 'resize', cols, rows })
      },
      reflow(cols: number, rows: number) {
        const current = optionsRef.current
        current.writeCoalescer.flushNow()
        current.postMessage({ type: 'reflow', cols, rows })
      },
      clear() {
        const current = optionsRef.current
        current.writeCoalescer.clear()
        current.postMessage({ type: 'clear' })
      },
      measureFitDimensions(containerHeight?: number) {
        const current = optionsRef.current
        return measureTerminalFitDimensions({
          containerHeight,
          isWebReadyRef: current.isWebReadyRef,
          measureResolveRef: current.measureResolveRef,
          sendToWebView: current.sendToWebView
        })
      },
      resetZoom() {
        optionsRef.current.postMessage({ type: 'reset-zoom' })
      },
      cancelSelect() {
        optionsRef.current.postMessage({ type: 'cancel-select' })
      },
      doSelectAll() {
        optionsRef.current.postMessage({ type: 'do-select-all' })
      },
      async awaitReady() {
        const p = optionsRef.current.readyPromiseRef.current
        if (!p) {
          return
        }
        await p
      }
    }),
    [ref]
  )
}
