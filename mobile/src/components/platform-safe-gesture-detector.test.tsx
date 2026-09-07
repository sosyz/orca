import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformSafeGestureDetector } from './platform-safe-gesture-detector'

const mockPlatform = vi.hoisted(() => ({ OS: 'ios' }))

vi.mock('react-native', () => ({ Platform: mockPlatform }))
vi.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }))

describe('PlatformSafeGestureDetector', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mockPlatform.OS = 'ios'
  })

  function render(): void {
    act(() => {
      renderer = create(
        createElement(
          PlatformSafeGestureDetector,
          { gesture: { kind: 'pinch' } as never },
          createElement('Content')
        )
      )
    })
  }

  it('does not mount the native detector on Harmony', () => {
    mockPlatform.OS = 'harmony'

    render()

    expect(renderer!.root.findAllByType('GestureDetector')).toHaveLength(0)
    expect(renderer!.root.findAllByType('Content')).toHaveLength(1)
  })

  it('delegates to the native detector on supported platforms', () => {
    render()

    const detector = renderer!.root.findByType('GestureDetector')
    expect(detector.props.gesture).toEqual({ kind: 'pinch' })
    expect(detector.findAllByType('Content')).toHaveLength(1)
  })
})
