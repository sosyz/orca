import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import { assertRpcOk } from './mobile-browser-frame-state'
import {
  computeBrowserFrameGeometry,
  computeBrowserTouchClickRadiusCss,
  mapScreenToBrowserPoint,
  type BrowserPoint,
  type BrowserTouchLayout,
  type BrowserZoomState
} from './browser-touch-geometry'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import type { MobileBrowserToastCopy } from './mobile-browser-copy'
import { MobileBrowserWheelCommandQueue } from './mobile-browser-wheel-command-queue'
import type { SendBrowserRequest } from './mobile-browser-interaction-contract'

const TOUCH_CLICK_RADIUS_DIP = 14
type BrowserPageParams = { worktree: string; page: string }

type MobileBrowserCommandArgs = {
  active: boolean
  client: RpcClient | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  keyboardValue: string
  layoutRef: { current: BrowserTouchLayout | null }
  onToast: (message: string, durationMs?: number) => void
  pageParams: () => BrowserPageParams | null
  pageInputActive: boolean
  pointerModifiers: BrowserPointerModifier[]
  sendBrowserRequest: SendBrowserRequest
  setDialog: Dispatch<SetStateAction<{ dialogType: string; message: string } | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setKeyboardValue: Dispatch<SetStateAction<string>>
  setPointerModifiers: Dispatch<SetStateAction<BrowserPointerModifier[]>>
  toasts: MobileBrowserToastCopy
  zoomRef: { current: BrowserZoomState }
}

export function useMobileBrowserCommands(args: MobileBrowserCommandArgs) {
  const {
    active,
    client,
    frameMetadataRef,
    keyboardValue,
    layoutRef,
    onToast,
    pageParams,
    pageInputActive,
    pointerModifiers,
    sendBrowserRequest,
    setDialog,
    setKeyboardValue,
    setPointerModifiers,
    toasts,
    zoomRef
  } = args

  const clientRef = useRef(client)
  const pageParamsRef = useRef<typeof pageParams | null>(pageParams)
  const commandScopeRef = useRef(0)
  const clickIntentRef = useRef(0)
  const keyboardEditRevisionRef = useRef(0)
  const keyboardSubmissionRef = useRef<object | null>(null)
  const wheelCommandQueueRef = useRef<MobileBrowserWheelCommandQueue | null>(null)
  if (!wheelCommandQueueRef.current) {
    wheelCommandQueueRef.current = new MobileBrowserWheelCommandQueue({
      readClient: () => clientRef.current
    })
  }

  const cancelWheelCommands = useCallback(() => {
    wheelCommandQueueRef.current?.cancel()
  }, [])

  useLayoutEffect(() => {
    commandScopeRef.current += 1
    cancelWheelCommands()
    clientRef.current = pageInputActive ? client : null
    pageParamsRef.current = pageParams
    keyboardSubmissionRef.current = null
    return () => {
      commandScopeRef.current += 1
      cancelWheelCommands()
      clientRef.current = null
      pageParamsRef.current = null
    }
  }, [cancelWheelCommands, client, pageInputActive, pageParams])

  const isCurrentPointerScope = useCallback(
    (scope: number, scopedClient: RpcClient) =>
      commandScopeRef.current === scope &&
      clientRef.current === scopedClient &&
      pageParamsRef.current === pageParams,
    [pageParams]
  )

  const sendPointerClick = useCallback(
    async (point: BrowserPoint, button: 'left' | 'right') => {
      const base = pageParams()
      if (!pageInputActive || !client || !base) {
        return
      }
      const scope = commandScopeRef.current
      if (!isCurrentPointerScope(scope, client)) {
        return
      }
      const intent = ++clickIntentRef.current
      const isCurrentIntent = () =>
        isCurrentPointerScope(scope, client) && clickIntentRef.current === intent
      let clearLegacyError: (() => void) | undefined
      await sendBrowserRequest(
        'browser.mouseClick',
        {
          x: point.x,
          y: point.y,
          button,
          modifiers: pointerModifiers,
          ...(button === 'left'
            ? {
                radius: computeBrowserTouchClickRadiusCss(
                  layoutRef.current,
                  frameMetadataRef.current,
                  zoomRef.current,
                  TOUCH_CLICK_RADIUS_DIP
                )
              }
            : {})
        },
        {
          timeoutMs: 5_000,
          onUnsupportedMethod: (clearErrorIfCurrent) => {
            clearLegacyError = clearErrorIfCurrent
          }
        }
      )
      if (!clearLegacyError || pointerModifiers.length > 0) {
        return
      }
      if (!isCurrentIntent()) {
        return
      }
      let pressed = false
      try {
        assertRpcOk(
          await client.sendRequest('browser.mouseMove', { ...base, x: point.x, y: point.y }),
          'Browser pointer move failed'
        )
        if (!isCurrentIntent()) {
          return
        }
        assertRpcOk(
          await client.sendRequest('browser.mouseDown', { ...base, button }),
          'Browser pointer down failed'
        )
        pressed = true
        if (!isCurrentIntent()) {
          return
        }
        assertRpcOk(
          await client.sendRequest('browser.mouseUp', { ...base, button }),
          'Browser pointer up failed'
        )
        pressed = false
        if (isCurrentIntent()) {
          clearLegacyError()
        }
      } catch {
        // Pointer commands can race page navigation. Keep the stream visible;
        // actionable failures still surface through navigation/stream errors.
      } finally {
        if (pressed) {
          try {
            await client.sendRequest('browser.mouseUp', { ...base, button })
          } catch {
            // Release cleanup is best-effort; the stale scope is already inactive.
          }
        }
      }
    },
    [
      client,
      isCurrentPointerScope,
      pageInputActive,
      pageParams,
      pointerModifiers,
      sendBrowserRequest
    ]
  )

  const togglePointerModifier = useCallback((modifier: BrowserPointerModifier) => {
    setPointerModifiers((current) =>
      current.includes(modifier)
        ? current.filter((candidate) => candidate !== modifier)
        : [...current, modifier]
    )
  }, [])

  const sendWheel = useCallback(
    (point: BrowserPoint, screenDx: number, screenDy: number, gestureId: number) => {
      const base = pageParams()
      if (!pageInputActive || !client || !base) {
        return
      }
      const currentLayout = layoutRef.current
      const geometry = computeBrowserFrameGeometry(currentLayout, frameMetadataRef.current)
      const localZoom = zoomRef.current.scale
      const scale = (geometry?.scale ?? 1) * localZoom
      const cssDx = screenDx / scale
      const cssDy = screenDy / scale
      const delta = { dx: roundWheelDelta(-cssDx), dy: roundWheelDelta(-cssDy) }
      if (Math.abs(delta.dx) < 1 && Math.abs(delta.dy) < 1) {
        return
      }
      wheelCommandQueueRef.current?.enqueue({ base, point, gestureId, ...delta })
    },
    [client, pageInputActive, pageParams]
  )

  const mapTouchPoint = useCallback((locationX: number, locationY: number): BrowserPoint | null => {
    return mapScreenToBrowserPoint(
      locationX,
      locationY,
      layoutRef.current,
      frameMetadataRef.current,
      zoomRef.current
    )
  }, [])

  const editKeyboardText = useCallback(
    (value: SetStateAction<string>) => {
      keyboardEditRevisionRef.current += 1
      setKeyboardValue(value)
    },
    [setKeyboardValue]
  )

  const sendKeyboardText = useCallback(async () => {
    const text = keyboardValue
    const scope = commandScopeRef.current
    if (
      !pageInputActive ||
      !client ||
      !text ||
      keyboardSubmissionRef.current ||
      !isCurrentPointerScope(scope, client)
    ) {
      return
    }
    const submission = {}
    keyboardSubmissionRef.current = submission
    const revision = keyboardEditRevisionRef.current
    setKeyboardValue('')
    try {
      const result = await sendBrowserRequest('browser.keyboardInsertText', { text })
      if (!isCurrentPointerScope(scope, client)) {
        return
      }
      if (result !== null) {
        onToast(toasts.sent)
      } else {
        setKeyboardValue((current) =>
          isCurrentPointerScope(scope, client) && keyboardEditRevisionRef.current === revision
            ? text
            : current
        )
      }
    } finally {
      if (keyboardSubmissionRef.current === submission) {
        keyboardSubmissionRef.current = null
      }
    }
  }, [
    client,
    isCurrentPointerScope,
    keyboardValue,
    onToast,
    pageInputActive,
    sendBrowserRequest,
    toasts.sent
  ])

  const sendKeypress = useCallback(
    async (key: string) => {
      if (!pageInputActive) {
        return
      }
      await sendBrowserRequest('browser.keypress', { key }, { suppressError: true })
    },
    [pageInputActive, sendBrowserRequest]
  )

  const sendDialogCommand = useCallback(
    async (method: 'browser.dialogAccept' | 'browser.dialogDismiss') => {
      if (!active) {
        return
      }
      setDialog(null)
      await sendBrowserRequest(method, {}, { suppressError: true, timeoutMs: 5_000 })
    },
    [active, sendBrowserRequest]
  )
  return {
    cancelWheelCommands,
    editKeyboardText,
    mapTouchPoint,
    sendDialogCommand,
    sendKeyboardText,
    sendKeypress,
    sendPointerClick,
    sendWheel,
    togglePointerModifier
  }
}

function roundWheelDelta(value: number): number {
  const rounded = Math.round(value)
  return Object.is(rounded, -0) ? 0 : rounded
}
