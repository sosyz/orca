import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState
} from 'react-native'
import {
  createPinchGesture,
  MAX_ZOOM,
  MIN_ZOOM,
  updatePinchZoom
} from './mobile-browser-frame-state'
import { clampBrowserZoomState, readLocalTouchPoint } from './browser-touch-geometry'
import type { MobileBrowserInteractionArgs } from './mobile-browser-interaction-contract'
import { useMobileBrowserCommands } from './use-mobile-browser-commands'
const TAP_SLOP = 16
const SCROLL_START_SLOP = 22
const LONG_PRESS_MS = 550
const WHEEL_MOVE_MIN_DELTA = 8

export function useMobileBrowserInteractions(args: MobileBrowserInteractionArgs) {
  const {
    active,
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
    scrollingRef,
    sendBrowserRequest,
    setDialog,
    setError,
    setKeyboardValue,
    setPointerModifiers,
    setZoom,
    startPointRef,
    toasts,
    zoomRef
  } = args
  const rightClickSentRef = useRef(false)
  const lastWheelRef = useRef({ dx: 0, dy: 0 })
  const remoteWheelScrollingRef = useRef(false)
  const wheelGestureIdRef = useRef(0)
  const commands = useMobileBrowserCommands({
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
    setError,
    setKeyboardValue,
    setPointerModifiers,
    toasts,
    zoomRef
  })
  const { cancelWheelCommands, mapTouchPoint, sendPointerClick, sendWheel } = commands

  const resetActiveGesture = useCallback(() => {
    clearLongPressTimer()
    pinchRef.current = null
    panRef.current = null
    remoteWheelScrollingRef.current = false
    scrollingRef.current = false
    startPointRef.current = null
  }, [clearLongPressTimer])

  const sendGestureWheelDelta = useCallback(
    (
      event: GestureResponderEvent,
      gesture: PanResponderGestureState,
      options: { force?: boolean } = {}
    ) => {
      const deltaX = gesture.dx - lastWheelRef.current.dx
      const deltaY = gesture.dy - lastWheelRef.current.dy
      if (!options.force && Math.abs(deltaX) + Math.abs(deltaY) < WHEEL_MOVE_MIN_DELTA) {
        return
      }
      if (options.force && Math.abs(deltaX) + Math.abs(deltaY) < 1) {
        return
      }
      const currentPoint = readLocalTouchPoint(event.nativeEvent)
      if (!currentPoint) {
        return
      }
      const point = mapTouchPoint(currentPoint.x, currentPoint.y)
      if (!point) {
        return
      }
      lastWheelRef.current = { dx: gesture.dx, dy: gesture.dy }
      sendWheel(point, deltaX, deltaY, wheelGestureIdRef.current)
    },
    [mapTouchPoint, sendWheel]
  )

  useEffect(() => {
    if (pageInputActive) {
      return
    }
    resetActiveGesture()
    cancelWheelCommands()
  }, [cancelWheelCommands, pageInputActive, resetActiveGesture])

  const handleResponderGrant = useCallback(
    (event: GestureResponderEvent) => {
      if (!pageInputActive) {
        return
      }
      const pinch = createPinchGesture(event, frameGeometry, zoomRef.current)
      if (pinch) {
        clearLongPressTimer()
        pinchRef.current = pinch
        panRef.current = null
        startPointRef.current = null
        return
      }
      const startPoint = readLocalTouchPoint(event.nativeEvent)
      if (!startPoint) {
        return
      }
      startPointRef.current = { x: startPoint.x, y: startPoint.y, t: Date.now() }
      rightClickSentRef.current = false
      remoteWheelScrollingRef.current = false
      scrollingRef.current = false
      wheelGestureIdRef.current += 1
      lastWheelRef.current = { dx: 0, dy: 0 }
      panRef.current =
        zoomRef.current.scale > MIN_ZOOM
          ? {
              x: startPoint.x,
              y: startPoint.y,
              offsetX: zoomRef.current.offsetX,
              offsetY: zoomRef.current.offsetY
            }
          : null
      clearLongPressTimer()
      longPressTimerRef.current = setTimeout(() => {
        const start = startPointRef.current
        if (!start) {
          return
        }
        const point = mapTouchPoint(start.x, start.y)
        if (!point) {
          return
        }
        rightClickSentRef.current = true
        void sendPointerClick(point, 'right')
        onToast(toasts.rightClick)
      }, LONG_PRESS_MS)
    },
    [
      clearLongPressTimer,
      frameGeometry,
      mapTouchPoint,
      onToast,
      pageInputActive,
      sendPointerClick,
      toasts.rightClick
    ]
  )

  const handleResponderMove = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (!pageInputActive) {
        return
      }
      const startedPinch = pinchRef.current
        ? null
        : createPinchGesture(event, frameGeometry, zoomRef.current)
      if (startedPinch) {
        clearLongPressTimer()
        pinchRef.current = startedPinch
        panRef.current = null
        startPointRef.current = null
      }
      const activePinch = pinchRef.current
      const nextPinch = activePinch ? updatePinchZoom(event, frameGeometry, activePinch) : null
      if (nextPinch) {
        clearLongPressTimer()
        zoomRef.current = nextPinch
        setZoom(nextPinch)
        return
      }
      if (activePinch) {
        pinchRef.current = null
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved > TAP_SLOP) {
        clearLongPressTimer()
      }
      const activePan = panRef.current
      if (activePan && frameGeometry) {
        const currentPoint = readLocalTouchPoint(event.nativeEvent)
        if (!currentPoint) {
          return
        }
        if (!scrollingRef.current && moved <= TAP_SLOP) {
          return
        }
        scrollingRef.current = true
        remoteWheelScrollingRef.current = false
        startPointRef.current = null
        const nextZoom = clampBrowserZoomState(
          {
            scale: zoomRef.current.scale,
            offsetX: activePan.offsetX + currentPoint.x - activePan.x,
            offsetY: activePan.offsetY + currentPoint.y - activePan.y
          },
          frameGeometry,
          MIN_ZOOM,
          MAX_ZOOM
        )
        zoomRef.current = nextZoom
        setZoom(nextZoom)
        return
      }
      if (!scrollingRef.current) {
        if (moved <= SCROLL_START_SLOP) {
          return
        }
        scrollingRef.current = true
        remoteWheelScrollingRef.current = true
        startPointRef.current = null
      }
      sendGestureWheelDelta(event, gesture)
    },
    [clearLongPressTimer, frameGeometry, pageInputActive, sendGestureWheelDelta]
  )

  const handleResponderRelease = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      clearLongPressTimer()
      pinchRef.current = null
      panRef.current = null
      const start = startPointRef.current
      startPointRef.current = null
      const wasScrolling = scrollingRef.current
      const wasRemoteScrolling = remoteWheelScrollingRef.current
      scrollingRef.current = false
      remoteWheelScrollingRef.current = false
      if (wasRemoteScrolling) {
        sendGestureWheelDelta(event, gesture, { force: true })
      }
      if (!start || rightClickSentRef.current || wasScrolling) {
        return
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved <= TAP_SLOP && Date.now() - start.t < LONG_PRESS_MS) {
        // Why: native browser taps resolve at touch-up. Using touch-down makes
        // tiny finger drift feel like the click lands left/up of the finger.
        const release = readLocalTouchPoint(event.nativeEvent) ?? start
        const point = mapTouchPoint(release.x, release.y)
        if (point) {
          void sendPointerClick(point, 'left')
        }
      }
    },
    [clearLongPressTimer, mapTouchPoint, sendGestureWheelDelta, sendPointerClick]
  )

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => pageInputActive && dialogRef.current === null,
        onMoveShouldSetPanResponder: () => pageInputActive && dialogRef.current === null,
        onPanResponderGrant: handleResponderGrant,
        onPanResponderMove: handleResponderMove,
        onPanResponderRelease: handleResponderRelease,
        onPanResponderTerminate: () => {
          resetActiveGesture()
          cancelWheelCommands()
        },
        onPanResponderTerminationRequest: () => true
      }),
    [
      cancelWheelCommands,
      handleResponderGrant,
      handleResponderMove,
      handleResponderRelease,
      pageInputActive,
      resetActiveGesture
    ]
  )

  return { ...commands, panResponder }
}
