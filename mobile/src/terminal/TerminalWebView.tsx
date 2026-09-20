import { useRef, useCallback, forwardRef, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import {
  useTerminalWebViewEngineErrorState,
  type NativeWebViewEngineEvent
} from './terminal-webview-engine-error-state'
import { useTerminalWebReadyWatchdog } from './terminal-webview-ready-watchdog'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'
import { getTerminalWebViewPlatformPolicy } from './terminal-webview-platform-policy'
import { useTerminalWebViewPlatformRecovery } from './terminal-webview-platform-recovery'
import { dispatchTerminalWebViewNotification } from './terminal-webview-notification-dispatch'
import { routeTerminalQueryReply } from './terminal-webview-query-reply-routing'
import { TerminalWebViewSurface } from './terminal-webview-surface'
import { useTerminalWebViewHandle } from './terminal-webview-handle'
import type { TerminalMeasureResolver } from './terminal-webview-measurement'
import { createTerminalWriteCoalescer } from './terminal-write-coalescer'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalWebView(
    {
      style,
      active = true,
      terminalTheme,
      textScale = 1,
      onWebReady,
      onEngineError,
      onSelectionMode,
      onSelectionCopy,
      onSelectionEvicted,
      onModesChanged,
      onKeyboardAvoidanceMetrics,
      onHaptic,
      onTerminalInput,
      onTerminalQueryReply,
      onTerminalTap,
      onFileTap,
      onOpenUrl,
      onTextScaleChange
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null)
    const platformPolicy = getTerminalWebViewPlatformPolicy(Platform.OS as string)
    const [webViewGeneration, setWebViewGeneration] = useState(0)
    const documentGenerationRef = useRef(webViewGeneration)
    const isWebReadyRef = useRef(false)
    const isBridgeReadyRef = useRef(false)
    const pendingMessages = useMemo(() => createTerminalWebViewPendingMessages(), [])
    const messageIdRef = useRef(0)
    const pendingPingIdRef = useRef<number | null>(null)
    const terminalThemeKey = useMemo(() => JSON.stringify(terminalTheme ?? null), [terminalTheme])
    const measureResolveRef = useRef<TerminalMeasureResolver | null>(null)
    const readyPromiseRef = useRef<Promise<void> | null>(null)
    const readyResolveRef = useRef<(() => void) | null>(null)
    const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const { clearEngineError, engineError, reportEngineError, reportNativeEngineError } =
      useTerminalWebViewEngineErrorState(onEngineError)
    const { armWebReadyWatchdog, clearWebReadyWatchdog } = useTerminalWebReadyWatchdog(
      isWebReadyRef,
      reportEngineError,
      active
    )

    const settleReady = useCallback(() => {
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
      }
      const resolve = readyResolveRef.current
      readyResolveRef.current = null
      readyPromiseRef.current = null
      resolve?.()
    }, [])

    const settlePendingOperations = useCallback(() => {
      measureResolveRef.current?.(null)
      measureResolveRef.current = null
      settleReady()
    }, [settleReady])

    const sendToWebView = useCallback((msg: TerminalWebViewCommand) => {
      messageIdRef.current += 1
      const id = messageIdRef.current
      webViewRef.current?.postMessage(JSON.stringify({ ...msg, id }))
      return id
    }, [])

    const flushPendingMessages = useCallback(() => {
      pendingMessages.flush(sendToWebView)
    }, [pendingMessages, sendToWebView])

    const postMessage = useCallback(
      (msg: TerminalWebViewCommand) => {
        if (!isWebReadyRef.current) {
          pendingMessages.queue(msg)
          return
        }
        sendToWebView(msg)
      },
      [pendingMessages, sendToWebView]
    )

    // Why: coalescing ~200 PTY frames/s avoids bridge, WebKit IPC, and paint heat (#9302).
    const writeCoalescer = useMemo(
      () => createTerminalWriteCoalescer((data) => postMessage({ type: 'write', data })),
      [postMessage]
    )

    useEffect(() => () => writeCoalescer.clear(), [writeCoalescer])

    const reloadNativeWebView = useCallback(() => webViewRef.current?.reload(), [])
    const remountWebViewSurface = useCallback(() => {
      const nextGeneration = documentGenerationRef.current + 1
      documentGenerationRef.current = nextGeneration
      setWebViewGeneration(nextGeneration)
    }, [])
    const reloadWebView = useTerminalWebViewPlatformRecovery({
      active,
      generation: webViewGeneration,
      platformPolicy,
      isBridgeReadyRef,
      isWebReadyRef,
      clearEngineError,
      clearWebReadyWatchdog,
      clearPendingMessages: pendingMessages.clear,
      clearPendingWrites: writeCoalescer.clear,
      reloadNativeWebView,
      remountWebViewSurface,
      settlePendingOperations
    })

    const confirmWebReady = useCallback(
      (notifyParent: boolean) => {
        const wasWebReady = isWebReadyRef.current
        pendingPingIdRef.current = null
        isBridgeReadyRef.current = true
        isWebReadyRef.current = true
        clearWebReadyWatchdog()
        clearEngineError()
        if (notifyParent && !wasWebReady) {
          onWebReady?.()
        }
        // Why: reload discards the document, so readiness must reapply the native-selected theme.
        sendToWebView({ type: 'set-theme', terminalTheme })
        flushPendingMessages()
      },
      [
        clearEngineError,
        clearWebReadyWatchdog,
        flushPendingMessages,
        onWebReady,
        sendToWebView,
        terminalTheme
      ]
    )

    const handleMessage = useCallback(
      (event: WebViewMessageEvent, generation: number) => {
        if (generation !== documentGenerationRef.current) {
          return
        }
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
        } catch {
          return
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
          return
        }
        routeTerminalQueryReply(msg, onTerminalQueryReply)

        if (msg.type === 'bridge-ready') {
          isBridgeReadyRef.current = true
          if (
            platformPolicy.bridgeReadiness === 'native-ack-gated' &&
            typeof msg.bridgeId === 'string'
          ) {
            sendToWebView({ type: 'bridge-ack', bridgeId: msg.bridgeId })
          }
        } else if (msg.type === 'web-ready') {
          confirmWebReady(true)
        } else if (
          msg.type === 'pong' &&
          typeof msg.pingId === 'number' &&
          msg.pingId === pendingPingIdRef.current
        ) {
          confirmWebReady(false)
        } else if (msg.type === 'ready') {
          // Why: the WebView's init() rAF chain has run — term is open,
          // renderService is populated, first paint has happened. Resolve
          // any pending awaitReady() so a queued measure can now safely
          // read cell dims.
          settleReady()
        } else if (msg.type === 'measure-result') {
          const resolve = measureResolveRef.current
          if (resolve && msg.measureId === resolve.requestId) {
            const cols = typeof msg.cols === 'number' ? msg.cols : null
            const rows = typeof msg.rows === 'number' ? msg.rows : null
            resolve(
              cols &&
                rows &&
                Number.isSafeInteger(cols) &&
                Number.isSafeInteger(rows) &&
                cols >= 20 &&
                rows >= 8
                ? { cols, rows }
                : null
            )
          }
        } else {
          dispatchTerminalWebViewNotification(msg, {
            reportEngineError,
            onSelectionMode,
            onSelectionCopy,
            onSelectionEvicted,
            onModesChanged,
            onKeyboardAvoidanceMetrics,
            onHaptic,
            onTerminalInput,
            onTerminalTap,
            onFileTap,
            onOpenUrl,
            onTextScaleChange
          })
        }
      },
      [
        confirmWebReady,
        reportEngineError,
        onSelectionMode,
        onSelectionCopy,
        onSelectionEvicted,
        onModesChanged,
        onKeyboardAvoidanceMetrics,
        onHaptic,
        onTerminalInput,
        onTerminalQueryReply,
        onTerminalTap,
        onFileTap,
        onOpenUrl,
        onTextScaleChange,
        platformPolicy.bridgeReadiness,
        sendToWebView,
        settleReady
      ]
    )

    const handleLoadStart = useCallback(
      (generation: number) => {
        if (generation !== documentGenerationRef.current) {
          return
        }
        if (platformPolicy.reloadStrategy === 'remount-surface' && isWebReadyRef.current) {
          return
        }
        settlePendingOperations()
        isBridgeReadyRef.current = false
        isWebReadyRef.current = false
        pendingPingIdRef.current = null
        armWebReadyWatchdog()
        // Why: messages queued for a previous WebView generation are stale after a reload;
        // dropping them avoids replaying terminal chunks before the next init snapshot.
        pendingMessages.clear()
        writeCoalescer.clear()
      },
      [
        armWebReadyWatchdog,
        pendingMessages,
        platformPolicy.reloadStrategy,
        settlePendingOperations,
        writeCoalescer
      ]
    )

    useEffect(() => {
      return settlePendingOperations
    }, [webViewGeneration, settlePendingOperations])

    const handleContentProcessDidTerminate = useCallback(() => {
      // Why: WKWebView content-process loss is recoverable; stale commands belong
      // to the dead document and the replacement must prove readiness before replay.
      isWebReadyRef.current = false
      pendingPingIdRef.current = null
      pendingMessages.clear()
      writeCoalescer.clear()
      clearEngineError()
      armWebReadyWatchdog()
      reloadWebView()
    }, [armWebReadyWatchdog, clearEngineError, pendingMessages, reloadWebView, writeCoalescer])

    useEffect(() => {
      postMessage({ type: 'set-theme', terminalTheme })
    }, [postMessage, terminalThemeKey, terminalTheme])

    // Why: live-apply text-size changes to an already-mounted terminal (the pane
    // stays alive while the user visits Settings), so no terminal reload is needed.
    useEffect(() => {
      postMessage({ type: 'set-font-scale', fontScale: textScale })
    }, [postMessage, textScale])

    useTerminalWebViewHandle({
      armWebReadyWatchdog,
      active,
      isWebReadyRef,
      measureResolveRef,
      pendingPingIdRef,
      platformPolicy,
      postMessage,
      recoverWebViewSurface: reloadWebView,
      readyPromiseRef,
      readyResolveRef,
      readyTimeoutRef,
      ref,
      sendToWebView,
      settleReady,
      terminalTheme,
      textScale,
      writeCoalescer
    })

    const reportNativeErrorForCurrentGeneration = useCallback(
      (context: string, event?: NativeWebViewEngineEvent) => {
        if (webViewGeneration === documentGenerationRef.current) {
          reportNativeEngineError(context, event)
        }
      },
      [reportNativeEngineError, webViewGeneration]
    )

    return (
      <TerminalWebViewSurface
        ref={webViewRef}
        bridgeReadiness={platformPolicy.bridgeReadiness}
        engineError={engineError}
        frameStyle={style}
        generation={webViewGeneration}
        onReload={reloadWebView}
        onLoadStart={() => handleLoadStart(webViewGeneration)}
        onMessage={(event) => handleMessage(event, webViewGeneration)}
        onError={(event) =>
          reportNativeErrorForCurrentGeneration('Terminal WebView load failed', event)
        }
        onHttpError={(event) =>
          reportNativeErrorForCurrentGeneration('Terminal WebView HTTP error', event)
        }
        onRenderProcessGone={(event) =>
          reportNativeErrorForCurrentGeneration('Terminal WebView render process ended', event)
        }
        onContentProcessDidTerminate={() => {
          if (webViewGeneration === documentGenerationRef.current) {
            handleContentProcessDidTerminate()
          }
        }}
      />
    )
  }
)
