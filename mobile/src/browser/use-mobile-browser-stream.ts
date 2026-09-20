import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { PixelRatio } from 'react-native'
import { buildMobileBrowserScreencastRequest } from './browser-screencast-request'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  getCachedBrowserFrame,
  updateBrowserLayerVisibility
} from './mobile-browser-frame-state'
import { clampBrowserZoomState, computeBrowserFrameGeometry } from './browser-touch-geometry'
import type { MobileBrowserStreamArgs } from './mobile-browser-stream-contract'
import { handleBrowserScreencastEvent, type ScreencastEvent } from './mobile-browser-stream-events'
import { useMobileBrowserFrameApply } from './use-mobile-browser-frame-apply'
import { useMobileBrowserRequest } from './use-mobile-browser-request'

export function useMobileBrowserStream(args: MobileBrowserStreamArgs) {
  const {
    active,
    appActive,
    browserImageRefs,
    browserLayerRefs,
    browserViewMode,
    busyRef,
    cacheKey,
    client,
    copy,
    frameLayerFrameRef,
    frameMetadata,
    frameMetadataRef,
    frameMountedRef,
    frameThrottleTimerRef,
    frameUriRef,
    lastAppliedFrameAtRef,
    lastStreamCacheKeyRef,
    lastZoomResetUrlRef,
    layout,
    pendingFrameLayerRef,
    pendingThrottledFrameRef,
    queuedFrameRef,
    resetBrowserZoomState,
    screencastSupported,
    setAddressValue,
    setBusy,
    setCommandError,
    setDialog,
    setError,
    setFrameInputReady,
    setFrameMetadata,
    setFrameUri,
    setZoom,
    streamGenerationRef,
    tab,
    visibleFrameLayerRef,
    worktreeId,
    zoomRef
  } = args
  const [streamAttempt, retryStream] = useReducer((attempt: number) => attempt + 1, 0)
  const copyRef = useRef(copy)
  copyRef.current = copy
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startupTimeoutMessageRef = useRef<string | null>(null)
  const clearStartupTimer = useCallback(() => {
    if (startupTimerRef.current !== null) {
      clearTimeout(startupTimerRef.current)
      startupTimerRef.current = null
    }
  }, [])
  const commitStreamFrame = useCallback(() => {
    clearStartupTimer()
    const timeoutMessage = startupTimeoutMessageRef.current
    startupTimeoutMessageRef.current = null
    if (timeoutMessage) {
      setError((current) => (current === timeoutMessage ? null : current))
    }
    busyRef.current = false
    setBusy(false)
    setFrameInputReady(true)
  }, [busyRef, clearStartupTimer, setFrameInputReady, setBusy, setError])
  const { pageParams, retirePendingFeedback, sendBrowserRequest } = useMobileBrowserRequest({
    busyRef,
    commandFailedMessage: copy.commandFailed,
    client,
    pageId: tab.browserPageId,
    setBusy,
    setError: setCommandError,
    worktreeId
  })

  const {
    applyFrameThrottled,
    clearFramePresentationQueue,
    clearFrameThrottle,
    mountCachedFramePresentation,
    resetFramePresentation
  } = useMobileBrowserFrameApply({
    browserImageRefs,
    browserLayerRefs,
    busyRef,
    frameLayerFrameRef,
    frameMetadataRef,
    frameMountedRef,
    frameThrottleTimerRef,
    frameUriRef,
    lastAppliedFrameAtRef,
    pendingFrameLayerRef,
    pendingThrottledFrameRef,
    queuedFrameRef,
    onFrameCommit: commitStreamFrame,
    setBusy,
    setFrameMetadata,
    setFrameUri,
    visibleFrameLayerRef
  })

  const streamRequest = useMemo(
    () => buildMobileBrowserScreencastRequest(layout, PixelRatio.get(), browserViewMode),
    [browserViewMode, layout]
  )

  const frameGeometry = useMemo(
    () => computeBrowserFrameGeometry(layout, frameMetadata),
    [frameMetadata, layout]
  )

  useEffect(() => {
    if (!frameGeometry) {
      return
    }
    setZoom((current) => {
      const next = clampBrowserZoomState(current, frameGeometry, MIN_ZOOM, MAX_ZOOM)
      if (
        next.scale === current.scale &&
        next.offsetX === current.offsetX &&
        next.offsetY === current.offsetY
      ) {
        return current
      }
      // Why: rotation/layout changes can shrink the legal pan range while the
      // current zoom state still points at the previous viewport geometry.
      zoomRef.current = next
      return next
    })
  }, [frameGeometry])

  useEffect(() => {
    streamGenerationRef.current += 1
    const generation = streamGenerationRef.current
    setFrameInputReady(false)
    const sameStream = Boolean(cacheKey) && lastStreamCacheKeyRef.current === cacheKey
    lastStreamCacheKeyRef.current = cacheKey
    if (!sameStream || !frameUriRef.current) {
      const cachedFrame = getCachedBrowserFrame(cacheKey)
      if (cachedFrame) {
        mountCachedFramePresentation(cacheKey, cachedFrame)
      } else {
        resetFramePresentation()
      }
    } else {
      frameMountedRef.current = true
      clearFramePresentationQueue()
    }
    if (!sameStream || !frameUriRef.current) {
      visibleFrameLayerRef.current = 0
    }
    updateBrowserLayerVisibility(browserLayerRefs.current, visibleFrameLayerRef.current)
    lastAppliedFrameAtRef.current = 0
    clearFrameThrottle()
    busyRef.current = false
    setDialog(null)
    setError(null)
    setCommandError(null)
    startupTimeoutMessageRef.current = null
    if (
      !client ||
      screencastSupported !== true ||
      !tab.browserPageId ||
      !active ||
      !appActive ||
      !streamRequest
    ) {
      busyRef.current = false
      setBusy(false)
      if (screencastSupported === false) {
        setError(copyRef.current.streamUnsupported)
      } else if (screencastSupported === null) {
        setError(copyRef.current.checkingSupport)
      } else if (!tab.browserPageId) {
        setError(copyRef.current.pageUnavailable)
      }
      return
    }
    busyRef.current = true
    setBusy(true)
    const startupTimer = setTimeout(() => {
      if (streamGenerationRef.current !== generation) {
        return
      }
      startupTimerRef.current = null
      clearFrameThrottle()
      clearFramePresentationQueue()
      busyRef.current = false
      setBusy(false)
      startupTimeoutMessageRef.current = copyRef.current.streamTimedOut
      setError(copyRef.current.streamTimedOut)
    }, 15_000)
    startupTimerRef.current = startupTimer
    const unsubscribe = client.subscribe(
      'browser.screencast',
      {
        worktree: `id:${worktreeId}`,
        page: tab.browserPageId,
        ...streamRequest
      },
      (payload) => {
        if (
          streamGenerationRef.current !== generation ||
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload)
        ) {
          return
        }
        if ((payload as ScreencastEvent).type === 'end') {
          streamGenerationRef.current += 1
          clearFrameThrottle()
          clearFramePresentationQueue()
          setFrameInputReady(false)
        }
        handleBrowserScreencastEvent({
          busyRef,
          clearStartupTimer,
          copy: copyRef.current,
          event: payload as ScreencastEvent,
          lastZoomResetUrlRef,
          resetBrowserZoomState,
          setAddressValue,
          setBusy,
          setDialog,
          setError
        })
      },
      {
        onBinaryFrame: (frame) => {
          if (streamGenerationRef.current !== generation) {
            return
          }
          if (cacheKey) {
            applyFrameThrottled(frame, cacheKey)
          }
        }
      }
    )
    return () => {
      streamGenerationRef.current += 1
      clearTimeout(startupTimer)
      if (startupTimerRef.current === startupTimer) {
        startupTimerRef.current = null
      }
      clearFrameThrottle()
      clearFramePresentationQueue()
      unsubscribe()
    }
  }, [
    appActive,
    applyFrameThrottled,
    active,
    clearFramePresentationQueue,
    clearFrameThrottle,
    clearStartupTimer,
    client,
    mountCachedFramePresentation,
    resetBrowserZoomState,
    resetFramePresentation,
    screencastSupported,
    setCommandError,
    setFrameInputReady,
    streamRequest,
    streamAttempt,
    cacheKey,
    tab.browserPageId,
    worktreeId
  ])

  return {
    commitStreamFrame,
    frameGeometry,
    pageParams,
    retirePendingFeedback,
    retryStream,
    sendBrowserRequest
  }
}
