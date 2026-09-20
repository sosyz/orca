import type { Dispatch, SetStateAction } from 'react'
import type { Image, View } from 'react-native'
import type {
  BrowserScreencastFrame,
  BrowserScreencastFrameMetadata
} from '../transport/browser-screencast-protocol'
import {
  browserFrameMetadataEqual,
  cacheBrowserFrame,
  createBrowserFrameDataUri,
  updateBrowserImageSource,
  updateBrowserLayerVisibility,
  type BrowserFrameCacheEntry,
  type FrameLayer
} from './mobile-browser-frame-state'

export type BrowserFramePresentationFrame = {
  cacheKey: string | null
  metadata: BrowserScreencastFrameMetadata
  uri: string
}

export type BrowserFrameDecodeRequest = {
  frame: BrowserScreencastFrame
  cacheKey: string | null
}

export type BrowserFramePresentationRefs = {
  browserImageRefs: { current: [Image | null, Image | null] }
  browserLayerRefs: { current: [View | null, View | null] }
  frameLayerFrameRef: {
    current: [BrowserFramePresentationFrame | null, BrowserFramePresentationFrame | null]
  }
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  frameMountedRef: { current: boolean }
  frameUriRef: { current: string | null }
  pendingFrameLayerRef: { current: FrameLayer | null }
  queuedFrameRef: { current: BrowserFrameDecodeRequest | null }
  visibleFrameLayerRef: { current: FrameLayer }
}

type BrowserFramePresentationSetters = {
  busyRef?: { current: boolean }
  onFrameCommit?: () => void
  setBusy?: Dispatch<SetStateAction<boolean>>
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setFrameUri: Dispatch<SetStateAction<string | null>>
}

export function createBrowserFramePresentationFrame(
  frame: BrowserScreencastFrame,
  cacheKey: string | null
): BrowserFramePresentationFrame {
  const uri = createBrowserFrameDataUri(frame)
  return { cacheKey, metadata: frame.metadata, uri }
}

export function presentMobileBrowserFrame(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  frame: BrowserScreencastFrame,
  cacheKey: string | null
): void {
  const nextFrame = { frame, cacheKey }
  if (refs.pendingFrameLayerRef.current !== null) {
    refs.queuedFrameRef.current = nextFrame
  } else if (!refs.frameMountedRef.current) {
    startBrowserFrameDecode(refs, setters, refs.visibleFrameLayerRef.current, nextFrame)
  } else {
    startBrowserFrameDecode(
      refs,
      setters,
      hiddenFrameLayer(refs.visibleFrameLayerRef.current),
      nextFrame
    )
  }
}

export function mountCachedBrowserFramePresentation(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  cacheKey: string | null,
  cachedFrame: BrowserFrameCacheEntry
): void {
  const frame = { cacheKey, metadata: cachedFrame.metadata, uri: cachedFrame.uri }
  refs.frameLayerFrameRef.current = [frame, null]
  refs.pendingFrameLayerRef.current = null
  refs.queuedFrameRef.current = null
  refs.visibleFrameLayerRef.current = 0
  refs.frameMountedRef.current = true
  refs.frameUriRef.current = frame.uri
  refs.frameMetadataRef.current = frame.metadata
  setters.setFrameUri(frame.uri)
  setters.setFrameMetadata(frame.metadata)
  updateBrowserLayerVisibility(refs.browserLayerRefs.current, 0)
  updateBrowserImageSource(refs.browserImageRefs.current[0], frame.uri)
}

export function resetBrowserFramePresentation(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters
): void {
  refs.frameLayerFrameRef.current = [null, null]
  refs.pendingFrameLayerRef.current = null
  refs.queuedFrameRef.current = null
  refs.visibleFrameLayerRef.current = 0
  refs.frameMountedRef.current = false
  refs.frameUriRef.current = null
  refs.frameMetadataRef.current = null
  setters.setFrameUri(null)
  setters.setFrameMetadata(null)
  updateBrowserLayerVisibility(refs.browserLayerRefs.current, 0)
}

export function clearBrowserFramePresentationQueue(
  refs: BrowserFramePresentationRefs,
  setters?: BrowserFramePresentationSetters
): void {
  const pendingLayer = refs.pendingFrameLayerRef.current
  if (pendingLayer !== null && pendingLayer !== refs.visibleFrameLayerRef.current) {
    refs.frameLayerFrameRef.current[pendingLayer] = null
  }
  refs.pendingFrameLayerRef.current = null
  refs.queuedFrameRef.current = null
  if (!refs.frameMountedRef.current) {
    refs.frameLayerFrameRef.current = [null, null]
    refs.frameUriRef.current = null
    setters?.setFrameUri(null)
    if (setters) {
      clearBrowserFrameBusy(setters)
    }
  }
}

export function syncBrowserFrameImageRef(
  refs: BrowserFramePresentationRefs,
  layer: FrameLayer,
  image: Image | null
): void {
  refs.browserImageRefs.current[layer] = image
  const frame = refs.frameLayerFrameRef.current[layer]
  if (image && frame) {
    updateBrowserImageSource(image, frame.uri)
  }
}

export function handleBrowserFramePresentationLoad(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  layer: FrameLayer,
  event?: unknown
): void {
  if (
    refs.pendingFrameLayerRef.current !== layer ||
    !pendingFrameMatchesNativeEvent(refs, layer, event)
  ) {
    return
  }
  refs.pendingFrameLayerRef.current = null
  commitBrowserFrameLayer(refs, setters, layer)
  startQueuedBrowserFrame(refs, setters)
}

export function handleBrowserFramePresentationError(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  layer: FrameLayer,
  event?: unknown
): void {
  if (
    refs.pendingFrameLayerRef.current !== layer ||
    !pendingFrameMatchesNativeEvent(refs, layer, event)
  ) {
    return
  }
  refs.pendingFrameLayerRef.current = null
  refs.frameLayerFrameRef.current[layer] = null
  if (refs.queuedFrameRef.current) {
    startQueuedBrowserFrame(refs, setters, layer)
    return
  }
  if (!refs.frameMountedRef.current) {
    refs.frameUriRef.current = null
    setters.setFrameUri(null)
    clearBrowserFrameBusy(setters)
  }
}

function startQueuedBrowserFrame(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  preferredLayer?: FrameLayer
): void {
  const queued = refs.queuedFrameRef.current
  refs.queuedFrameRef.current = null
  if (!queued) {
    return
  }
  startBrowserFrameDecode(
    refs,
    setters,
    preferredLayer ?? hiddenFrameLayer(refs.visibleFrameLayerRef.current),
    queued
  )
}

function startBrowserFrameDecode(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  layer: FrameLayer,
  request: BrowserFrameDecodeRequest
): void {
  const frame = createBrowserFramePresentationFrame(request.frame, request.cacheKey)
  refs.frameLayerFrameRef.current[layer] = frame
  refs.pendingFrameLayerRef.current = layer
  if (!refs.frameMountedRef.current) {
    setters.setFrameUri(frame.uri)
  }
  updateBrowserImageSource(refs.browserImageRefs.current[layer], frame.uri)
}

function commitBrowserFrameLayer(
  refs: BrowserFramePresentationRefs,
  setters: BrowserFramePresentationSetters,
  layer: FrameLayer
): void {
  const frame = refs.frameLayerFrameRef.current[layer]
  if (!frame) {
    return
  }
  const wasMounted = refs.frameMountedRef.current
  refs.frameMountedRef.current = true
  refs.frameUriRef.current = frame.uri
  if (!wasMounted) {
    setters.setFrameUri(frame.uri)
  }
  if (!browserFrameMetadataEqual(refs.frameMetadataRef.current, frame.metadata)) {
    refs.frameMetadataRef.current = frame.metadata
    setters.setFrameMetadata(frame.metadata)
  }
  cacheBrowserFrame(frame.cacheKey, { uri: frame.uri, metadata: frame.metadata })
  refs.visibleFrameLayerRef.current = layer
  updateBrowserLayerVisibility(refs.browserLayerRefs.current, layer)
  setters.onFrameCommit?.()
  clearBrowserFrameBusy(setters)
}

function clearBrowserFrameBusy(setters: BrowserFramePresentationSetters): void {
  if (setters.busyRef?.current && setters.setBusy) {
    setters.busyRef.current = false
    setters.setBusy(false)
  }
}

function pendingFrameMatchesNativeEvent(
  refs: BrowserFramePresentationRefs,
  layer: FrameLayer,
  event: unknown
): boolean {
  const eventUri = readNativeImageEventUri(event)
  const frame = refs.frameLayerFrameRef.current[layer]
  return !eventUri || !frame || eventUri === frame.uri
}

function readNativeImageEventUri(event: unknown): string | null {
  const source =
    event && typeof event === 'object'
      ? ((event as { nativeEvent?: { source?: unknown } }).nativeEvent?.source as
          | Record<string, unknown>
          | undefined)
      : undefined
  const uri = source?.uri ?? source?.url
  return typeof uri === 'string' && uri.length > 0 ? uri : null
}

function hiddenFrameLayer(visibleLayer: FrameLayer): FrameLayer {
  return visibleLayer === 0 ? 1 : 0
}
