import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileRouteBackHandler } from './use-mobile-route-back-handler'

const navigationMock = vi.hoisted(() => ({
  current: {} as { registerBackHandler?: (handler: () => boolean) => () => void },
  useNavigation: vi.fn(() => navigationMock.current)
}))
const backHandlerMock = vi.hoisted(() => ({
  addEventListener: vi.fn((_event: string, _handler: () => boolean) => ({ remove: vi.fn() }))
}))

vi.mock('expo-router', () => ({
  useNavigation: navigationMock.useNavigation
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: backHandlerMock.addEventListener }
}))

function Harness({ onBack }: { onBack: () => boolean }): null {
  useMobileRouteBackHandler(onBack)
  return null
}

describe('useMobileRouteBackHandler', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    navigationMock.current = {}
    navigationMock.useNavigation.mockClear()
    backHandlerMock.addEventListener.mockClear()
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('uses the route-scoped Harmony owner when available', async () => {
    const onBack = vi.fn(() => true)
    const unsubscribe = vi.fn()
    const registerBackHandler = vi.fn(() => unsubscribe)
    navigationMock.current = { registerBackHandler }

    await act(async () => {
      renderer = create(createElement(Harness, { onBack }))
    })

    expect(registerBackHandler).toHaveBeenCalledWith(onBack)
    expect(backHandlerMock.addEventListener).not.toHaveBeenCalled()

    act(() => renderer?.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps the native BackHandler fallback for iOS and Android', async () => {
    const onBack = vi.fn(() => true)
    const remove = vi.fn()
    backHandlerMock.addEventListener.mockReturnValueOnce({ remove })

    await act(async () => {
      renderer = create(createElement(Harness, { onBack }))
    })

    expect(backHandlerMock.addEventListener).toHaveBeenCalledWith('hardwareBackPress', onBack)

    act(() => renderer?.unmount())
    expect(remove).toHaveBeenCalledOnce()
  })
})
