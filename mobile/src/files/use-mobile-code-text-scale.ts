import { useCallback, useMemo, useRef, useState } from 'react'
import { PanResponder, type GestureResponderEvent } from 'react-native'
import {
  mobileCodePinchDistance,
  mobileCodeScaleFromPinch,
  quantizeMobileCodeTextScale,
  stepMobileCodeTextScale
} from './mobile-code-text-scale'

type PinchStart = {
  distance: number
  scale: number
}

export function useMobileCodeTextScale() {
  const [textScale, setTextScale] = useState(1)
  const textScaleRef = useRef(textScale)
  const pinchStartRef = useRef<PinchStart | null>(null)
  textScaleRef.current = textScale

  const commitTextScale = useCallback((proposedScale: number) => {
    const nextScale = quantizeMobileCodeTextScale(proposedScale)
    if (nextScale === textScaleRef.current) {
      return
    }
    textScaleRef.current = nextScale
    setTextScale(nextScale)
  }, [])

  const beginPinch = useCallback((event: GestureResponderEvent) => {
    const distance = mobileCodePinchDistance(event.nativeEvent.touches)
    pinchStartRef.current = distance ? { distance, scale: textScaleRef.current } : null
  }, [])

  const updatePinch = useCallback(
    (event: GestureResponderEvent) => {
      const distance = mobileCodePinchDistance(event.nativeEvent.touches)
      if (!distance) {
        pinchStartRef.current = null
        return
      }
      const start = pinchStartRef.current
      if (!start) {
        pinchStartRef.current = { distance, scale: textScaleRef.current }
        return
      }
      commitTextScale(mobileCodeScaleFromPinch(start.scale, start.distance, distance))
    },
    [commitTextScale]
  )

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture the second touch before a nested ScrollView can keep the responder.
        onStartShouldSetPanResponder: (event) =>
          mobileCodePinchDistance(event.nativeEvent.touches) !== null,
        onStartShouldSetPanResponderCapture: (event) =>
          mobileCodePinchDistance(event.nativeEvent.touches) !== null,
        onMoveShouldSetPanResponder: (event) =>
          mobileCodePinchDistance(event.nativeEvent.touches) !== null,
        onMoveShouldSetPanResponderCapture: (event) =>
          mobileCodePinchDistance(event.nativeEvent.touches) !== null,
        onPanResponderGrant: beginPinch,
        onPanResponderMove: updatePinch,
        onPanResponderRelease: () => {
          pinchStartRef.current = null
        },
        onPanResponderTerminate: () => {
          pinchStartRef.current = null
        },
        onPanResponderTerminationRequest: () => false
      }),
    [beginPinch, updatePinch]
  )

  const zoomOut = useCallback(() => {
    commitTextScale(stepMobileCodeTextScale(textScaleRef.current, -1))
  }, [commitTextScale])
  const zoomIn = useCallback(() => {
    commitTextScale(stepMobileCodeTextScale(textScaleRef.current, 1))
  }, [commitTextScale])
  const resetZoom = useCallback(() => commitTextScale(1), [commitTextScale])

  return {
    textScale,
    panHandlers: panResponder.panHandlers,
    zoomOut,
    zoomIn,
    resetZoom
  }
}
