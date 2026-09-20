import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { Image, View } from 'react-native'
import type {
  BrowserScreencastFrame,
  BrowserScreencastFrameMetadata
} from '../transport/browser-screencast-protocol'
import { MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS } from './browser-screencast-request'
import {
  clearBrowserFramePresentationQueue,
  mountCachedBrowserFramePresentation,
  presentMobileBrowserFrame,
  resetBrowserFramePresentation,
  type BrowserFrameDecodeRequest,
  type BrowserFramePresentationFrame,
  type BrowserFramePresentationRefs
} from './mobile-browser-frame-presentation'
import type { BrowserFrameCacheEntry, FrameLayer } from './mobile-browser-frame-state'

type PendingFrame = { frame: BrowserScreencastFrame; cacheKey: string }
type BrowserFrameApplyArgs = {
  browserImageRefs: { current: [Image | null, Image | null] }
  browserLayerRefs: { current: [View | null, View | null] }
  busyRef: { current: boolean }
  frameLayerFrameRef: {
    current: [BrowserFramePresentationFrame | null, BrowserFramePresentationFrame | null]
  }
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  frameMountedRef: { current: boolean }
  frameThrottleTimerRef: { current: ReturnType<typeof setTimeout> | null }
  frameUriRef: { current: string | null }
  lastAppliedFrameAtRef: { current: number }
  onFrameCommit: () => void
  pendingFrameLayerRef: { current: FrameLayer | null }
  pendingThrottledFrameRef: { current: PendingFrame | null }
  queuedFrameRef: { current: BrowserFrameDecodeRequest | null }
  setBusy: Dispatch<SetStateAction<boolean>>
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setFrameUri: Dispatch<SetStateAction<string | null>>
  visibleFrameLayerRef: { current: FrameLayer }
}
export function useMobileBrowserFrameApply(args: BrowserFrameApplyArgs) {
  const {
    browserImageRefs,
    browserLayerRefs,
    busyRef,
    frameLayerFrameRef,
    frameMetadataRef,
    frameMountedRef,
    frameThrottleTimerRef,
    frameUriRef,
    lastAppliedFrameAtRef,
    onFrameCommit,
    pendingFrameLayerRef,
    pendingThrottledFrameRef,
    queuedFrameRef,
    setBusy,
    setFrameMetadata,
    setFrameUri,
    visibleFrameLayerRef
  } = args
  const presentationRefs = useMemo<BrowserFramePresentationRefs>(
    () => ({
      browserImageRefs,
      browserLayerRefs,
      frameLayerFrameRef,
      frameMetadataRef,
      frameMountedRef,
      frameUriRef,
      pendingFrameLayerRef,
      queuedFrameRef,
      visibleFrameLayerRef
    }),
    [
      browserImageRefs,
      browserLayerRefs,
      frameLayerFrameRef,
      frameMetadataRef,
      frameMountedRef,
      frameUriRef,
      pendingFrameLayerRef,
      queuedFrameRef,
      visibleFrameLayerRef
    ]
  )
  const applyFrame = useCallback(
    (frame: BrowserScreencastFrame, frameCacheKey: string): void => {
      presentMobileBrowserFrame(
        presentationRefs,
        { busyRef, onFrameCommit, setBusy, setFrameMetadata, setFrameUri },
        frame,
        frameCacheKey
      )
    },
    [busyRef, onFrameCommit, presentationRefs, setBusy, setFrameMetadata, setFrameUri]
  )

  const clearFrameThrottle = useCallback(() => {
    pendingThrottledFrameRef.current = null
    if (frameThrottleTimerRef.current) {
      clearTimeout(frameThrottleTimerRef.current)
      frameThrottleTimerRef.current = null
    }
  }, [frameThrottleTimerRef, pendingThrottledFrameRef])

  const applyFrameThrottled = useCallback(
    (frame: BrowserScreencastFrame, frameCacheKey: string): void => {
      const now = Date.now()
      const elapsed = now - lastAppliedFrameAtRef.current
      if (lastAppliedFrameAtRef.current === 0 || elapsed >= MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS) {
        clearFrameThrottle()
        lastAppliedFrameAtRef.current = now
        applyFrame(frame, frameCacheKey)
        return
      }

      // Why: static UI changes can be the last frame Chromium emits. Coalesce
      // throttled frames so the final visible state is applied after the delay.
      pendingThrottledFrameRef.current = { frame, cacheKey: frameCacheKey }
      if (frameThrottleTimerRef.current) {
        return
      }
      frameThrottleTimerRef.current = setTimeout(
        () => {
          frameThrottleTimerRef.current = null
          const pending = pendingThrottledFrameRef.current
          pendingThrottledFrameRef.current = null
          if (!pending) {
            return
          }
          lastAppliedFrameAtRef.current = Date.now()
          applyFrame(pending.frame, pending.cacheKey)
        },
        Math.max(0, MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS - elapsed)
      )
    },
    [applyFrame, clearFrameThrottle]
  )
  const clearFramePresentationQueue = useCallback(() => {
    clearBrowserFramePresentationQueue(presentationRefs, {
      busyRef,
      setBusy,
      setFrameMetadata,
      setFrameUri
    })
  }, [busyRef, presentationRefs, setBusy, setFrameMetadata, setFrameUri])

  const mountCachedFramePresentation = useCallback(
    (frameCacheKey: string | null, cachedFrame: BrowserFrameCacheEntry) => {
      mountCachedBrowserFramePresentation(
        presentationRefs,
        { setFrameMetadata, setFrameUri },
        frameCacheKey,
        cachedFrame
      )
    },
    [presentationRefs, setFrameMetadata, setFrameUri]
  )

  const resetFramePresentation = useCallback(() => {
    resetBrowserFramePresentation(presentationRefs, { setFrameMetadata, setFrameUri })
  }, [presentationRefs, setFrameMetadata, setFrameUri])

  return {
    applyFrameThrottled,
    clearFramePresentationQueue,
    clearFrameThrottle,
    mountCachedFramePresentation,
    resetFramePresentation
  }
}
