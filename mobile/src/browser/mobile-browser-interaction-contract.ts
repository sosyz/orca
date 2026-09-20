import type { Dispatch, SetStateAction } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import type {
  BrowserFrameGeometry,
  BrowserTouchLayout,
  BrowserZoomState
} from './browser-touch-geometry'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import type { MobileBrowserToastCopy } from './mobile-browser-copy'
import type { PinchGesture } from './mobile-browser-frame-state'

export type BrowserPageParams = { worktree: string; page: string }
export type PanGesture = { x: number; y: number; offsetX: number; offsetY: number }
export type BrowserRequestOptions = {
  showBusy?: boolean
  suppressError?: boolean
  timeoutMs?: number
  onUnsupportedMethod?: (clearErrorIfCurrent: () => void) => void
}
export type SendBrowserRequest = (
  method: string,
  params?: Record<string, unknown>,
  options?: BrowserRequestOptions
) => Promise<unknown | null>

export type MobileBrowserInteractionArgs = {
  active: boolean
  clearLongPressTimer: () => void
  client: RpcClient | null
  dialogRef: { current: { dialogType: string; message: string } | null }
  frameGeometry: BrowserFrameGeometry | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  keyboardValue: string
  layoutRef: { current: BrowserTouchLayout | null }
  longPressTimerRef: { current: ReturnType<typeof setTimeout> | null }
  onToast: (message: string, durationMs?: number) => void
  pageParams: () => BrowserPageParams | null
  pageInputActive: boolean
  panRef: { current: PanGesture | null }
  pinchRef: { current: PinchGesture | null }
  pointerModifiers: BrowserPointerModifier[]
  scrollingRef: { current: boolean }
  sendBrowserRequest: SendBrowserRequest
  setDialog: Dispatch<SetStateAction<{ dialogType: string; message: string } | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setKeyboardValue: Dispatch<SetStateAction<string>>
  setPointerModifiers: Dispatch<SetStateAction<BrowserPointerModifier[]>>
  setZoom: Dispatch<SetStateAction<BrowserZoomState>>
  startPointRef: { current: { x: number; y: number; t: number } | null }
  toasts: MobileBrowserToastCopy
  zoomRef: { current: BrowserZoomState }
}
