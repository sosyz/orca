import type { Dispatch, SetStateAction } from 'react'
import { displayBrowserUrl } from './browser-url'
import type { MobileBrowserErrorCopy } from './mobile-browser-copy'
import { shouldSurfaceBrowserError } from './mobile-browser-frame-state'

export type BrowserDialogState = { dialogType: string; message: string }

export type ScreencastEvent = {
  type?: string
  message?: string
  error?: { message?: string }
  dialogType?: string
  tab?: { url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean }
}

type HandleScreencastEventArgs = {
  busyRef: { current: boolean }
  clearStartupTimer: () => void
  event: ScreencastEvent
  copy: Pick<MobileBrowserErrorCopy, 'dialogFallbackMessage' | 'streamFailed'>
  lastZoomResetUrlRef: { current: string }
  resetBrowserZoomState: () => void
  setAddressValue: Dispatch<SetStateAction<string>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setDialog: Dispatch<SetStateAction<BrowserDialogState | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export function handleBrowserScreencastEvent(args: HandleScreencastEventArgs): void {
  const {
    busyRef,
    clearStartupTimer,
    copy,
    event,
    lastZoomResetUrlRef,
    resetBrowserZoomState,
    setAddressValue,
    setBusy,
    setDialog,
    setError
  } = args

  if (event.type === 'ready') {
    if (busyRef.current) {
      busyRef.current = false
      setBusy(false)
    }
    if (typeof event.tab?.url === 'string') {
      setAddressValue(displayBrowserUrl(event.tab.url))
      if (event.tab.url !== lastZoomResetUrlRef.current) {
        lastZoomResetUrlRef.current = event.tab.url
        resetBrowserZoomState()
      }
    }
  } else if (event.type === 'end') {
    clearStartupTimer()
    setError(copy.streamFailed)
    if (busyRef.current) {
      busyRef.current = false
      setBusy(false)
    }
  } else if (event.type === 'dialog') {
    setDialog({
      dialogType: event.dialogType ?? 'alert',
      message: event.message ?? copy.dialogFallbackMessage
    })
  } else if (event.type === 'dialogClosed') {
    setDialog(null)
  } else if (event.type === 'error') {
    if (busyRef.current) {
      busyRef.current = false
      setBusy(false)
    }
    const message = event.message ?? event.error?.message ?? copy.streamFailed
    if (shouldSurfaceBrowserError(message)) {
      clearStartupTimer()
      setError(message)
    }
  }
}
