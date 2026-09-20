import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { displayBrowserUrl, normalizeBrowserUrl } from './browser-url'
import type { SendBrowserRequest } from './mobile-browser-interaction-contract'

type BrowserHistoryControlsArgs = {
  controlsDisabled: boolean
  canGoBack: boolean
  canGoForward: boolean
  retryStream: () => void
  setFrameInputReady: (ready: boolean) => void
  sendBrowserRequest: SendBrowserRequest
  retirePendingFeedback: () => void
  addressValue: string
  invalidUrlMessage: string
  lastZoomResetUrlRef: { current: string }
  resetBrowserZoomState: () => void
  setAddressValue: Dispatch<SetStateAction<string>>
  setError: (message: string) => void
}

export function useMobileBrowserHistoryControls({
  controlsDisabled,
  canGoBack,
  canGoForward,
  retryStream,
  setFrameInputReady,
  sendBrowserRequest,
  retirePendingFeedback,
  addressValue,
  invalidUrlMessage,
  lastZoomResetUrlRef,
  resetBrowserZoomState,
  setAddressValue,
  setError
}: BrowserHistoryControlsArgs) {
  const revisionRef = useRef(0)
  const addressEditRevisionRef = useRef(0)
  const committedRequestRef = useRef<SendBrowserRequest | null>(null)
  useLayoutEffect(() => {
    committedRequestRef.current = sendBrowserRequest
    return () => {
      if (committedRequestRef.current === sendBrowserRequest) {
        committedRequestRef.current = null
      }
    }
  }, [sendBrowserRequest])
  const isCurrentSource = useCallback(
    () => committedRequestRef.current === sendBrowserRequest,
    [sendBrowserRequest]
  )
  const editAddressValue = useCallback(
    (value: SetStateAction<string>) => {
      addressEditRevisionRef.current += 1
      setAddressValue(value)
    },
    [setAddressValue]
  )
  const beginNavigation = useCallback(() => {
    revisionRef.current += 1
    setFrameInputReady(false)
    return revisionRef.current
  }, [setFrameInputReady])
  const navigateToAddress = useCallback(async () => {
    if (!isCurrentSource()) {
      return
    }
    retirePendingFeedback()
    const url = normalizeBrowserUrl(addressValue)
    if (!url) {
      setError(invalidUrlMessage)
      return
    }
    const addressEditRevision = addressEditRevisionRef.current
    const revision = beginNavigation()
    const result = (await sendBrowserRequest(
      'browser.goto',
      { url },
      { showBusy: true, timeoutMs: 30_000 }
    )) as { url?: string } | null
    if (
      revisionRef.current === revision &&
      addressEditRevisionRef.current === addressEditRevision &&
      typeof result?.url === 'string'
    ) {
      setAddressValue(displayBrowserUrl(result.url))
      lastZoomResetUrlRef.current = result.url
      resetBrowserZoomState()
    }
  }, [
    addressValue,
    beginNavigation,
    invalidUrlMessage,
    isCurrentSource,
    lastZoomResetUrlRef,
    retirePendingFeedback,
    resetBrowserZoomState,
    sendBrowserRequest,
    setAddressValue,
    setError
  ])
  const goBack = useCallback(() => {
    if (!isCurrentSource() || controlsDisabled || !canGoBack) {
      return
    }
    beginNavigation()
    void sendBrowserRequest('browser.back', {}, { suppressError: true })
  }, [controlsDisabled, canGoBack, isCurrentSource, sendBrowserRequest, beginNavigation])
  const goForward = useCallback(() => {
    if (!isCurrentSource() || controlsDisabled || !canGoForward) {
      return
    }
    beginNavigation()
    void sendBrowserRequest('browser.forward', {}, { suppressError: true })
  }, [controlsDisabled, canGoForward, isCurrentSource, sendBrowserRequest, beginNavigation])
  const reloadPage = useCallback(() => {
    if (!isCurrentSource() || controlsDisabled) {
      return
    }
    beginNavigation()
    void sendBrowserRequest('browser.reload', {}, { suppressError: true })
    retryStream()
  }, [controlsDisabled, isCurrentSource, retryStream, sendBrowserRequest, beginNavigation])
  return { editAddressValue, goBack, goForward, navigateToAddress, reloadPage }
}
