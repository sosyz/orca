import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { Image, View } from 'react-native'
import type { BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import {
  handleBrowserFramePresentationError,
  handleBrowserFramePresentationLoad,
  syncBrowserFrameImageRef,
  type BrowserFrameDecodeRequest,
  type BrowserFramePresentationFrame,
  type BrowserFramePresentationRefs
} from './mobile-browser-frame-presentation'
import { updateBrowserLayerVisibility, type FrameLayer } from './mobile-browser-frame-state'
import { mobileBrowserPaneStyles as styles } from './mobile-browser-pane-styles'

type BrowserLayerHandlersArgs = {
  browserImageRefs: { current: [Image | null, Image | null] }
  browserLayerRefs: { current: [View | null, View | null] }
  frameLayerFrameRef: {
    current: [BrowserFramePresentationFrame | null, BrowserFramePresentationFrame | null]
  }
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  frameMountedRef: { current: boolean }
  frameUriRef: { current: string | null }
  onFrameCommit: () => void
  pendingFrameLayerRef: { current: FrameLayer | null }
  queuedFrameRef: { current: BrowserFrameDecodeRequest | null }
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setFrameUri: Dispatch<SetStateAction<string | null>>
  visibleFrameLayerRef: { current: FrameLayer }
}

export function useMobileBrowserPaneLayers(args: BrowserLayerHandlersArgs) {
  const {
    browserImageRefs,
    browserLayerRefs,
    frameLayerFrameRef,
    frameMetadataRef,
    frameMountedRef,
    frameUriRef,
    onFrameCommit,
    pendingFrameLayerRef,
    queuedFrameRef,
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

  const setBrowserImageRef = useCallback(
    (layer: FrameLayer, image: Image | null) => {
      syncBrowserFrameImageRef(presentationRefs, layer, image)
    },
    [presentationRefs]
  )

  const setBrowserLayerRef = useCallback(
    (layer: FrameLayer, view: View | null) => {
      browserLayerRefs.current[layer] = view
      updateBrowserLayerVisibility(browserLayerRefs.current, visibleFrameLayerRef.current)
    },
    [browserLayerRefs, visibleFrameLayerRef]
  )

  const setBrowserLayer0Ref = useCallback(
    (view: View | null) => setBrowserLayerRef(0, view),
    [setBrowserLayerRef]
  )
  const setBrowserLayer1Ref = useCallback(
    (view: View | null) => setBrowserLayerRef(1, view),
    [setBrowserLayerRef]
  )
  const setBrowserImageLayer0Ref = useCallback(
    (image: Image | null) => setBrowserImageRef(0, image),
    [setBrowserImageRef]
  )
  const setBrowserImageLayer1Ref = useCallback(
    (image: Image | null) => setBrowserImageRef(1, image),
    [setBrowserImageRef]
  )

  const handleBrowserImageLoad = useCallback(
    (layer: FrameLayer, event?: unknown) => {
      if (pendingFrameLayerRef.current !== layer) {
        return
      }
      handleBrowserFramePresentationLoad(
        presentationRefs,
        { onFrameCommit, setFrameMetadata, setFrameUri },
        layer,
        event
      )
    },
    [onFrameCommit, pendingFrameLayerRef, presentationRefs, setFrameMetadata, setFrameUri]
  )

  const handleBrowserImageLayer0Load = useCallback(
    (event?: unknown) => handleBrowserImageLoad(0, event),
    [handleBrowserImageLoad]
  )
  const handleBrowserImageLayer1Load = useCallback(
    (event?: unknown) => handleBrowserImageLoad(1, event),
    [handleBrowserImageLoad]
  )

  const handleBrowserImageError = useCallback(
    (layer: FrameLayer, event?: unknown) => {
      if (pendingFrameLayerRef.current === layer) {
        handleBrowserFramePresentationError(
          presentationRefs,
          { onFrameCommit, setFrameMetadata, setFrameUri },
          layer,
          event
        )
      }
    },
    [onFrameCommit, pendingFrameLayerRef, presentationRefs, setFrameMetadata, setFrameUri]
  )

  const handleBrowserImageLayer0Error = useCallback(
    (event?: unknown) => handleBrowserImageError(0, event),
    [handleBrowserImageError]
  )
  const handleBrowserImageLayer1Error = useCallback(
    (event?: unknown) => handleBrowserImageError(1, event),
    [handleBrowserImageError]
  )

  const frameLayerStyle = useCallback(
    (layer: FrameLayer) => {
      return [
        styles.browserImageLayer,
        visibleFrameLayerRef.current !== layer && styles.browserImageLayerHidden
      ]
    },
    [visibleFrameLayerRef]
  )

  const browserLayerRef = useCallback(
    (layer: FrameLayer) => (layer === 0 ? setBrowserLayer0Ref : setBrowserLayer1Ref),
    [setBrowserLayer0Ref, setBrowserLayer1Ref]
  )

  const frameLayerRef = useCallback(
    (layer: FrameLayer) => (layer === 0 ? setBrowserImageLayer0Ref : setBrowserImageLayer1Ref),
    [setBrowserImageLayer0Ref, setBrowserImageLayer1Ref]
  )

  const frameLayerLoadHandler = useCallback(
    (layer: FrameLayer) =>
      layer === 0 ? handleBrowserImageLayer0Load : handleBrowserImageLayer1Load,
    [handleBrowserImageLayer0Load, handleBrowserImageLayer1Load]
  )

  const frameLayerErrorHandler = useCallback(
    (layer: FrameLayer) =>
      layer === 0 ? handleBrowserImageLayer0Error : handleBrowserImageLayer1Error,
    [handleBrowserImageLayer0Error, handleBrowserImageLayer1Error]
  )

  return {
    browserLayerRef,
    frameLayerErrorHandler,
    frameLayerLoadHandler,
    frameLayerRef,
    frameLayerStyle
  }
}
