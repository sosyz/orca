/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: mobile browser state mirrors a remote desktop screencast session and CDP dialogs, which are external systems that cannot be derived during render. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppState, type Image, type View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RpcClient } from '../transport/rpc-client'
import type {
  BrowserScreencastFrame,
  BrowserScreencastFrameMetadata
} from '../transport/browser-screencast-protocol'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import {
  getInitialMobileBrowserViewMode,
  saveMobileBrowserViewMode
} from './mobile-browser-view-mode-state'
import type { BrowserTouchLayout, BrowserZoomState } from './browser-touch-geometry'
import {
  clearCachedBrowserFramesForWorktree,
  makeBrowserFrameCacheKey,
  makeMobileBrowserPaneBoundaryKey,
  peekCachedBrowserFrame,
  type FrameLayer,
  type PinchGesture
} from './mobile-browser-frame-state'
import type {
  BrowserFrameDecodeRequest,
  BrowserFramePresentationFrame
} from './mobile-browser-frame-presentation'
import { displayBrowserUrl } from './browser-url'
import { resolveMobileBrowserAddressSync } from './mobile-browser-address-sync'
import type { PanGesture } from './mobile-browser-interaction-contract'
import { createMobileBrowserCopy } from './mobile-browser-copy'
import type { BrowserDialogState } from './mobile-browser-stream-events'
import { MobileBrowserPaneView } from './MobileBrowserPaneView'
import { useMobileBrowserInteractions } from './use-mobile-browser-interactions'
import { useMobileBrowserPaneLayers } from './use-mobile-browser-pane-layers'
import { useMobileBrowserStream } from './use-mobile-browser-stream'
import { useMobileBrowserHistoryControls } from './use-mobile-browser-history-controls'

export type MobileBrowserTab = {
  type: 'browser'
  id: string
  title: string
  browserWorkspaceId: string
  browserPageId: string | null
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

type MobileBrowserPaneProps = {
  client: RpcClient | null
  pairedHostId: string
  worktreeId: string
  tab: MobileBrowserTab
  screencastSupported: boolean | null
  keyboardLift: number
  bottomInset: number
  active?: boolean
  onToast: (message: string, durationMs?: number) => void
}

const DEFAULT_ZOOM: BrowserZoomState = { scale: 1, offsetX: 0, offsetY: 0 }

export function MobileBrowserPane(props: MobileBrowserPaneProps) {
  return (
    <MobileBrowserPaneFrameBoundary
      key={makeMobileBrowserPaneBoundaryKey(
        props.pairedHostId,
        props.worktreeId,
        props.tab.browserPageId,
        props.tab.id
      )}
      {...props}
    />
  )
}

function MobileBrowserPaneFrameBoundary({
  client,
  pairedHostId,
  worktreeId,
  tab,
  screencastSupported,
  keyboardLift,
  bottomInset,
  active = true,
  onToast
}: MobileBrowserPaneProps) {
  const { i18n, t } = useTranslation()
  const copy = useMemo(
    () => createMobileBrowserCopy((key, options) => t(key, options)),
    [i18n.language, t]
  )
  const [browserViewMode, setBrowserViewMode] = useState<MobileBrowserViewMode>(() =>
    getInitialMobileBrowserViewMode(worktreeId, tab.browserPageId, tab.url)
  )
  const cacheKey = makeBrowserFrameCacheKey(
    pairedHostId,
    worktreeId,
    tab.browserPageId,
    browserViewMode
  )
  const cachedInitialFrame = peekCachedBrowserFrame(cacheKey)
  const initialFrame: BrowserFramePresentationFrame | null = cachedInitialFrame
    ? {
        cacheKey,
        metadata: cachedInitialFrame.metadata,
        uri: cachedInitialFrame.uri
      }
    : null
  const [addressValue, setAddressValue] = useState(displayBrowserUrl(tab.url))
  const [addressFocused, setAddressFocused] = useState(false)
  const [addressSyncState, setAddressSyncState] = useState({
    focused: false,
    url: tab.url
  })
  const [keyboardValue, setKeyboardValue] = useState('')
  const [frameUri, setFrameUri] = useState<string | null>(cachedInitialFrame?.uri ?? null)
  const [frameMetadata, setFrameMetadata] = useState<BrowserScreencastFrameMetadata | null>(
    cachedInitialFrame?.metadata ?? null
  )
  const [frameInputReady, setFrameInputReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<BrowserDialogState | null>(null)
  const [pointerModifiers, setPointerModifiers] = useState<BrowserPointerModifier[]>([])
  const [zoom, setZoom] = useState<BrowserZoomState>(DEFAULT_ZOOM)
  const [layout, setLayout] = useState<BrowserTouchLayout | null>(null)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const streamGenerationRef = useRef(0)
  const layoutRef = useRef<BrowserTouchLayout | null>(null)
  const frameMetadataRef = useRef<BrowserScreencastFrameMetadata | null>(
    cachedInitialFrame?.metadata ?? null
  )
  const frameUriRef = useRef<string | null>(cachedInitialFrame?.uri ?? null)
  const frameMountedRef = useRef(cachedInitialFrame !== null)
  const browserImageRefs = useRef<[Image | null, Image | null]>([null, null])
  const browserLayerRefs = useRef<[View | null, View | null]>([null, null])
  const frameLayerFrameRef = useRef<
    [BrowserFramePresentationFrame | null, BrowserFramePresentationFrame | null]
  >([initialFrame, null])
  const pendingFrameLayerRef = useRef<FrameLayer | null>(null)
  const queuedFrameRef = useRef<BrowserFrameDecodeRequest | null>(null)
  const visibleFrameLayerRef = useRef<FrameLayer>(0)
  const busyRef = useRef(false)
  const lastAppliedFrameAtRef = useRef(0)
  const pendingThrottledFrameRef = useRef<{
    frame: BrowserScreencastFrame
    cacheKey: string
  } | null>(null)
  const frameThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialogRef = useRef<BrowserDialogState | null>(null)
  const lastStreamCacheKeyRef = useRef<string | null>(cacheKey)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPointRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const scrollingRef = useRef(false)
  const zoomRef = useRef<BrowserZoomState>(DEFAULT_ZOOM)
  const pinchRef = useRef<PinchGesture | null>(null)
  const panRef = useRef<PanGesture | null>(null)
  const lastZoomResetUrlRef = useRef(tab.url || 'about:blank')

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const setRootViewRef = useCallback(
    (node: View | null) => {
      // Why: long-press right-click timers belong to this responder surface;
      // clearing from ref cleanup preserves the same unmount boundary.
      if (node === null) {
        clearLongPressTimer()
      }
    },
    [clearLongPressTimer]
  )

  const resetBrowserZoomState = useCallback(() => {
    clearLongPressTimer()
    pinchRef.current = null
    panRef.current = null
    scrollingRef.current = false
    startPointRef.current = null
    zoomRef.current = DEFAULT_ZOOM
    setZoom(DEFAULT_ZOOM)
  }, [clearLongPressTimer])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active'
      if (!active) {
        clearCachedBrowserFramesForWorktree(pairedHostId, worktreeId)
      }
      setAppActive(active)
    })
    return () => {
      subscription.remove()
    }
  }, [pairedHostId, worktreeId])

  const addressSync = resolveMobileBrowserAddressSync(addressSyncState, {
    focused: addressFocused,
    url: tab.url
  })
  if (addressSync.nextState !== addressSyncState) {
    setAddressSyncState(addressSync.nextState)
    if (addressSync.shouldSyncValue) {
      // Why: keep browser stream/goto address updates intact, but avoid a
      // stale post-blur paint when the tab URL is the source of truth.
      setAddressValue(displayBrowserUrl(tab.url))
    }
  }

  useLayoutEffect(() => {
    // Why: gesture and stream handlers need committed values before passive
    // Effects flush, without leaking refs from an uncommitted render.
    frameMetadataRef.current = frameMetadata
    layoutRef.current = layout
    dialogRef.current = dialog
    zoomRef.current = zoom
  }, [dialog, frameMetadata, layout, zoom])

  useEffect(() => {
    setFrameInputReady(false)
    lastZoomResetUrlRef.current = tab.url || 'about:blank'
    resetBrowserZoomState()
  }, [resetBrowserZoomState, tab.browserPageId, tab.url])

  useEffect(() => {
    setBrowserViewMode(getInitialMobileBrowserViewMode(worktreeId, tab.browserPageId, tab.url))
  }, [tab.browserPageId, tab.url, worktreeId])

  const {
    commitStreamFrame,
    frameGeometry,
    pageParams,
    retirePendingFeedback,
    retryStream,
    sendBrowserRequest
  } = useMobileBrowserStream({
    active,
    appActive,
    browserImageRefs,
    browserLayerRefs,
    browserViewMode,
    busyRef,
    cacheKey,
    client,
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
    copy: copy.errors,
    setAddressValue,
    setBusy,
    setCommandError,
    setDialog,
    setError: setStreamError,
    setFrameInputReady,
    setFrameMetadata,
    setFrameUri,
    setZoom,
    streamGenerationRef,
    tab,
    visibleFrameLayerRef,
    worktreeId,
    zoomRef
  })

  const controlsDisabled = !active || !client || !tab.browserPageId || screencastSupported !== true
  const pageInputActive = !controlsDisabled && appActive && frameInputReady
  const browserCommandActive = !controlsDisabled && appActive
  const {
    editKeyboardText,
    panResponder,
    sendDialogCommand,
    sendKeyboardText,
    sendKeypress,
    togglePointerModifier
  } = useMobileBrowserInteractions({
    active: browserCommandActive,
    clearLongPressTimer,
    client,
    dialogRef,
    frameGeometry,
    frameMetadataRef,
    keyboardValue,
    layoutRef,
    longPressTimerRef,
    onToast,
    pageParams,
    pageInputActive,
    panRef,
    pinchRef,
    pointerModifiers,
    sendBrowserRequest,
    scrollingRef,
    startPointRef,
    toasts: copy.toasts,
    setDialog,
    setError: setCommandError,
    setKeyboardValue,
    setPointerModifiers,
    setZoom,
    zoomRef
  })

  const {
    browserLayerRef,
    frameLayerErrorHandler,
    frameLayerLoadHandler,
    frameLayerRef,
    frameLayerStyle
  } = useMobileBrowserPaneLayers({
    browserImageRefs,
    browserLayerRefs,
    frameLayerFrameRef,
    frameMetadataRef,
    frameMountedRef,
    frameUriRef,
    onFrameCommit: commitStreamFrame,
    pendingFrameLayerRef,
    queuedFrameRef,
    setFrameMetadata,
    setFrameUri,
    visibleFrameLayerRef
  })

  const { editAddressValue, goBack, goForward, navigateToAddress, reloadPage } =
    useMobileBrowserHistoryControls({
      controlsDisabled,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      retryStream,
      setFrameInputReady,
      sendBrowserRequest,
      retirePendingFeedback,
      addressValue,
      invalidUrlMessage: copy.errors.invalidUrl,
      lastZoomResetUrlRef,
      resetBrowserZoomState,
      setAddressValue,
      setError: setCommandError
    })

  const selectBrowserViewMode = useCallback(
    (mode: MobileBrowserViewMode) => {
      if (browserViewMode === mode) {
        return
      }
      // Why: preserve explicit page-scoped choices across normal browser pane remounts.
      saveMobileBrowserViewMode(worktreeId, tab.browserPageId, mode)
      setBrowserViewMode(mode)
      resetBrowserZoomState()
    },
    [browserViewMode, resetBrowserZoomState, tab.browserPageId, worktreeId]
  )

  const hasRenderedFrame = frameMountedRef.current

  return (
    <MobileBrowserPaneView
      addressFocused={addressFocused}
      addressValue={addressValue}
      bottomInset={bottomInset}
      browserLayerRef={browserLayerRef}
      browserViewMode={browserViewMode}
      busy={busy}
      controlsDisabled={controlsDisabled}
      copy={copy}
      dialog={dialog}
      error={streamError ?? commandError}
      frameGeometry={frameGeometry}
      frameLayerErrorHandler={frameLayerErrorHandler}
      frameLayerLoadHandler={frameLayerLoadHandler}
      frameLayerRef={frameLayerRef}
      frameLayerStyle={frameLayerStyle}
      goBack={goBack}
      goForward={goForward}
      keyboardLift={keyboardLift}
      keyboardValue={keyboardValue}
      layoutRef={layoutRef}
      navigateToAddress={navigateToAddress}
      panResponder={panResponder}
      pageInputDisabled={!pageInputActive}
      pointerModifiers={pointerModifiers}
      reloadPage={reloadPage}
      hasFrameSource={Boolean(frameUriRef.current || frameUri)}
      hasRenderedFrame={hasRenderedFrame}
      selectBrowserViewMode={selectBrowserViewMode}
      sendDialogCommand={sendDialogCommand}
      sendKeyboardText={sendKeyboardText}
      sendKeypress={sendKeypress}
      setAddressFocused={setAddressFocused}
      setAddressValue={editAddressValue}
      setKeyboardValue={editKeyboardText}
      setLayout={setLayout}
      setRootViewRef={setRootViewRef}
      tab={tab}
      togglePointerModifier={togglePointerModifier}
      zoom={zoom}
    />
  )
}
