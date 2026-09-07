import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  PanResponder: {
    create: (handlers: Record<string, unknown>) => ({ panHandlers: handlers })
  }
}))

import { useMobileCodeTextScale } from './use-mobile-code-text-scale'

type Controller = ReturnType<typeof useMobileCodeTextScale>

function touchEvent(distance: number) {
  return {
    nativeEvent: {
      touches: [
        { pageX: 0, pageY: 0 },
        { pageX: distance, pageY: 0 }
      ]
    }
  } as never
}

function oneTouchEvent() {
  return {
    nativeEvent: {
      touches: [{ pageX: 0, pageY: 0 }]
    }
  } as never
}

describe('useMobileCodeTextScale', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: Controller | null = null

  function Probe(): null {
    controller = useMobileCodeTextScale()
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })

  it('captures the second touch before nested scrolling and commits pinch scale', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    const handlers = controller!.panHandlers as Record<string, (...args: never[]) => unknown>

    expect(handlers.onStartShouldSetPanResponderCapture?.(oneTouchEvent())).toBe(false)
    expect(handlers.onStartShouldSetPanResponderCapture?.(touchEvent(100))).toBe(true)
    expect(handlers.onMoveShouldSetPanResponderCapture?.(touchEvent(100))).toBe(true)
    expect(handlers.onStartShouldSetPanResponder?.(touchEvent(100))).toBe(true)

    act(() => handlers.onPanResponderGrant?.(touchEvent(100)))
    act(() => handlers.onPanResponderMove?.(touchEvent(145)))
    expect(controller!.textScale).toBe(1.5)
  })

  it('supports accessible button stepping and reset', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => controller!.zoomIn())
    expect(controller!.textScale).toBe(1.1)
    act(() => controller!.zoomOut())
    expect(controller!.textScale).toBe(1)
    act(() => controller!.zoomIn())
    act(() => controller!.resetZoom())
    expect(controller!.textScale).toBe(1)
  })
})
