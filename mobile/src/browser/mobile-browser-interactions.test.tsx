import { createElement, useCallback, useRef, useState } from 'react'
import { act, create } from 'react-test-renderer'
import type {
  GestureResponderEvent,
  PanResponderCallbacks,
  PanResponderGestureState
} from 'react-native'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import { computeBrowserFrameGeometry, type BrowserZoomState } from './browser-touch-geometry'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import type { PinchGesture } from './mobile-browser-frame-state'
import { useMobileBrowserInteractions } from './use-mobile-browser-interactions'

const { panResponderCreateMock } = vi.hoisted(() => ({
  panResponderCreateMock: vi.fn((callbacks: PanResponderCallbacks) => ({
    panHandlers: {},
    testCallbacks: callbacks
  }))
}))

vi.mock('react-native', () => ({
  PanResponder: { create: panResponderCreateMock }
}))

const metadata: BrowserScreencastFrameMetadata = {
  deviceHeight: 100,
  deviceWidth: 100,
  pageScaleFactor: 1
}
const defaultZoom: BrowserZoomState = { offsetX: 0, offsetY: 0, scale: 1 }
const okResponse = { ok: true, result: {} } as const

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve()
  }
}

function touchEvent(locationX: number, locationY: number): GestureResponderEvent {
  return {
    nativeEvent: {
      locationX,
      locationY,
      touches: []
    }
  } as unknown as GestureResponderEvent
}

function gesture(dx: number, dy: number): PanResponderGestureState {
  return { dx, dy } as PanResponderGestureState
}

function Harness({ client }: { client: RpcClient }) {
  const frameMetadataRef = useRef(metadata)
  const layoutRef = useRef({ height: 100, width: 100 })
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollingRef = useRef(false)
  const startPointRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const pinchRef = useRef<PinchGesture | null>(null)
  const panRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const dialogRef = useRef<{ dialogType: string; message: string } | null>(null)
  const zoomRef = useRef(defaultZoom)
  const [keyboardValue, setKeyboardValue] = useState('')
  const [pointerModifiers, setPointerModifiers] = useState<BrowserPointerModifier[]>([])
  const [, setDialog] = useState<{ dialogType: string; message: string } | null>(null)
  const [, setError] = useState<string | null>(null)
  const [, setZoom] = useState(defaultZoom)
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  useMobileBrowserInteractions({
    active: true,
    clearLongPressTimer,
    client,
    dialogRef,
    frameGeometry: computeBrowserFrameGeometry(layoutRef.current, frameMetadataRef.current),
    frameMetadataRef,
    keyboardValue,
    layoutRef,
    longPressTimerRef,
    onToast: () => {},
    pageParams: () => ({ page: 'page-a', worktree: 'worktree-a' }),
    pageInputActive: true,
    panRef,
    pinchRef,
    pointerModifiers,
    scrollingRef,
    sendBrowserRequest: vi.fn(async () => null),
    setDialog,
    setError,
    setKeyboardValue,
    setPointerModifiers,
    setZoom,
    startPointRef,
    toasts: { rightClick: 'Right click', sent: 'Sent' },
    zoomRef
  })

  return createElement('Harness')
}

describe('useMobileBrowserInteractions', () => {
  beforeEach(() => {
    panResponderCreateMock.mockClear()
  })

  it('flushes the final remote wheel delta on touch release', async () => {
    const client = {
      sendRequest: vi.fn(async () => okResponse)
    } as unknown as RpcClient

    await act(async () => {
      create(createElement(Harness, { client }))
      await Promise.resolve()
    })

    const callbacks = panResponderCreateMock.mock.calls[0][0] as PanResponderCallbacks

    act(() => {
      callbacks.onPanResponderGrant?.(touchEvent(50, 50), gesture(0, 0))
      callbacks.onPanResponderMove?.(touchEvent(50, 74), gesture(0, 24))
      callbacks.onPanResponderRelease?.(touchEvent(50, 79), gesture(0, 29))
    })
    await drainMicrotasks()

    expect(client.sendRequest).toHaveBeenNthCalledWith(1, 'browser.mouseMove', {
      page: 'page-a',
      worktree: 'worktree-a',
      x: 50,
      y: 74
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(2, 'browser.mouseWheel', {
      dx: 0,
      dy: -24,
      page: 'page-a',
      worktree: 'worktree-a'
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(3, 'browser.mouseMove', {
      page: 'page-a',
      worktree: 'worktree-a',
      x: 50,
      y: 79
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(4, 'browser.mouseWheel', {
      dx: 0,
      dy: -5,
      page: 'page-a',
      worktree: 'worktree-a'
    })
  })
})
