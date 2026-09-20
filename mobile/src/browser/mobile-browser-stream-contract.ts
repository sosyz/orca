import type { Dispatch, SetStateAction } from 'react'
import type { Image, View } from 'react-native'
import type {
  BrowserScreencastFrame,
  BrowserScreencastFrameMetadata
} from '../transport/browser-screencast-protocol'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import type { BrowserTouchLayout, BrowserZoomState } from './browser-touch-geometry'
import type {
  BrowserFrameDecodeRequest,
  BrowserFramePresentationFrame
} from './mobile-browser-frame-presentation'
import type { MobileBrowserTab } from './MobileBrowserPane'
import type { MobileBrowserErrorCopy } from './mobile-browser-copy'
import type { FrameLayer } from './mobile-browser-frame-state'
import type { BrowserDialogState } from './mobile-browser-stream-events'
import type { RpcClient } from '../transport/rpc-client'

type PendingFrame = { frame: BrowserScreencastFrame; cacheKey: string }

export type MobileBrowserStreamArgs = {
  active: boolean
  appActive: boolean
  browserImageRefs: { current: [Image | null, Image | null] }
  browserLayerRefs: { current: [View | null, View | null] }
  browserViewMode: MobileBrowserViewMode
  busyRef: { current: boolean }
  cacheKey: string | null
  client: RpcClient | null
  copy: MobileBrowserErrorCopy
  frameLayerFrameRef: {
    current: [BrowserFramePresentationFrame | null, BrowserFramePresentationFrame | null]
  }
  frameMetadata: BrowserScreencastFrameMetadata | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  frameMountedRef: { current: boolean }
  frameThrottleTimerRef: { current: ReturnType<typeof setTimeout> | null }
  frameUriRef: { current: string | null }
  lastAppliedFrameAtRef: { current: number }
  lastStreamCacheKeyRef: { current: string | null }
  lastZoomResetUrlRef: { current: string }
  layout: BrowserTouchLayout | null
  pendingFrameLayerRef: { current: FrameLayer | null }
  pendingThrottledFrameRef: { current: PendingFrame | null }
  queuedFrameRef: { current: BrowserFrameDecodeRequest | null }
  resetBrowserZoomState: () => void
  screencastSupported: boolean | null
  setAddressValue: Dispatch<SetStateAction<string>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setCommandError: Dispatch<SetStateAction<string | null>>
  setDialog: Dispatch<SetStateAction<BrowserDialogState | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setFrameInputReady: Dispatch<SetStateAction<boolean>>
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setFrameUri: Dispatch<SetStateAction<string | null>>
  setZoom: Dispatch<SetStateAction<BrowserZoomState>>
  streamGenerationRef: { current: number }
  tab: MobileBrowserTab
  visibleFrameLayerRef: { current: FrameLayer }
  worktreeId: string
  zoomRef: { current: BrowserZoomState }
}
