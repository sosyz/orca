import { Buffer } from 'node:buffer'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairingOffer } from '../transport/types'

const mocks = vi.hoisted(() => ({
  code: '',
  router: { replace: vi.fn() },
  refreshHostClient: vi.fn(),
  startPreProfilePairing: vi.fn(),
  connectionLogEntries: [] as Array<{ detail?: string; message: string }>,
  loadMobileOnboardingSteps: vi.fn(async () => []),
  mobileOnboardingDestination: vi.fn((_steps: readonly unknown[], hostId?: string) =>
    hostId ? `/h/${hostId}` : '/'
  )
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({ code: mocks.code }),
  useRouter: () => mocks.router
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
}))

vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))

vi.mock('../transport/client-context', () => ({
  useRefreshHostClient: () => mocks.refreshHostClient
}))

vi.mock('../transport/pre-profile-pairing-coordinator', () => ({
  startPreProfilePairing: mocks.startPreProfilePairing
}))

vi.mock('../onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: mocks.loadMobileOnboardingSteps,
  mobileOnboardingDestination: mocks.mobileOnboardingDestination
}))

vi.mock('../components/ConnectionLog', () => ({
  ConnectionLog: (props: { entries: Array<{ detail?: string; message: string }> }) => {
    mocks.connectionLogEntries = props.entries
    return null
  }
}))

import PairConfirmScreen from '../../app/pair-confirm'

function encodeOffer(offer: PairingOffer): string {
  return Buffer.from(JSON.stringify(offer))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

const offer: PairingOffer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key'
}

describe('pair-confirm route', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.code = encodeOffer(offer)
    mocks.router.replace.mockReset()
    mocks.refreshHostClient.mockReset()
    mocks.startPreProfilePairing.mockReset()
    mocks.connectionLogEntries = []
    mocks.loadMobileOnboardingSteps.mockClear()
    mocks.mobileOnboardingDestination.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function renderScreen(): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(PairConfirmScreen), {
        createNodeMock: () => ({})
      })
    })
    return renderer as ReactTestRenderer
  }

  function textContent(instance: ReactTestRenderer): string[] {
    return instance.root
      .findAllByType('Text')
      .flatMap((node) =>
        node.children.filter((child): child is string => typeof child === 'string')
      )
  }

  function pairButton(instance: ReactTestRenderer) {
    return instance.root
      .findAllByType('Pressable')
      .find((node) => node.findAllByType('Text').some((text) => text.children.includes('Pair')))
  }

  it('renders a valid pairing code and starts pairing from the Pair button', () => {
    const instance = renderScreen()

    expect(textContent(instance)).toContain('Pair with this desktop?')
    expect(pairButton(instance)).toBeDefined()

    const attempt = {
      result: new Promise<{ hostId: string }>(() => {}),
      timedOut: false,
      dispose: vi.fn()
    }
    mocks.startPreProfilePairing.mockReturnValue(attempt)

    act(() => pairButton(instance)!.props.onPress())

    expect(mocks.startPreProfilePairing).toHaveBeenCalledWith(
      expect.objectContaining({ offer, timeoutMs: expect.any(Number) })
    )
  })

  it('refreshes the paired host and navigates after successful pairing', async () => {
    const instance = renderScreen()
    let resolveResult!: (value: { hostId: string }) => void
    const result = new Promise<{ hostId: string }>((resolve) => {
      resolveResult = resolve
    })
    const attempt = { result, timedOut: false, dispose: vi.fn() }
    mocks.startPreProfilePairing.mockReturnValue(attempt)

    await act(async () => {
      pairButton(instance)!.props.onPress()
      resolveResult({ hostId: 'host-42' })
      await result
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.refreshHostClient).toHaveBeenCalledOnce()
    expect(mocks.refreshHostClient).toHaveBeenCalledWith('host-42')
    expect(mocks.router.replace).toHaveBeenCalledWith('/h/host-42')
    expect(mocks.mobileOnboardingDestination).toHaveBeenCalledWith([], 'host-42')
  })

  it('redacts live pairing logs before rendering them', () => {
    const instance = renderScreen()
    const attempt = {
      result: new Promise<{ hostId: string }>(() => {}),
      timedOut: false,
      dispose: vi.fn()
    }
    mocks.startPreProfilePairing.mockReturnValue(attempt)

    act(() => pairButton(instance)!.props.onPress())
    const pairingOptions = mocks.startPreProfilePairing.mock.calls[0][0]
    act(() => {
      pairingOptions.connectOptions.onLog({
        id: 'secret-log',
        ts: 1,
        level: 'error',
        message: 'orca://pair#fragment-secret',
        detail: 'deviceToken=direct-secret'
      })
    })

    expect(mocks.connectionLogEntries).toEqual([
      expect.objectContaining({
        message: 'orca://pair#[redacted]',
        detail: 'deviceToken=[redacted]'
      })
    ])
  })

  it('does not navigate when the pairing screen unmounts before pairing resolves', async () => {
    const instance = renderScreen()
    let resolveResult!: (value: { hostId: string }) => void
    const result = new Promise<{ hostId: string }>((resolve) => {
      resolveResult = resolve
    })
    const attempt = { result, timedOut: false, dispose: vi.fn() }
    mocks.startPreProfilePairing.mockReturnValue(attempt)

    act(() => pairButton(instance)!.props.onPress())
    act(() => {
      renderer?.unmount()
      renderer = null
    })
    resolveResult({ hostId: 'host-late' })

    await act(async () => {
      await result
      await Promise.resolve()
    })

    expect(attempt.dispose).toHaveBeenCalled()
    expect(mocks.refreshHostClient).not.toHaveBeenCalled()
    expect(mocks.router.replace).not.toHaveBeenCalled()
  })
})
