import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAnimatedComponent = vi.fn((component: unknown) => component)

vi.mock('react-native', () => ({
  ScrollView: function P() {},
  Platform: { OS: 'harmony' }
}))

vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent }
}))

describe('ReanimatedScrollView', () => {
  beforeEach(() => {
    vi.resetModules()
    createAnimatedComponent.mockClear()
  })

  it('wraps a function-based native ScrollView with a forwardRef boundary', async () => {
    await import('./reanimated-scroll-view')

    expect(createAnimatedComponent).toHaveBeenCalledOnce()
    expect(typeof createAnimatedComponent.mock.calls[0]?.[0]).not.toBe('function')
  })
})
