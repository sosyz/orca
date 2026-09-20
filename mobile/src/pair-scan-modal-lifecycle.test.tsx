import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import PairScanScreen from '../app/pair-scan'
import { startPreProfilePairing } from './transport/pre-profile-pairing-coordinator'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openSettings: vi.fn() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: false, canAskAgain: true }, vi.fn()]
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Clipboard: 'Clipboard',
  QrCode: 'QrCode'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('./transport/client-context', () => ({ useRefreshHostClient: () => vi.fn() }))
vi.mock('./onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: vi.fn(),
  mobileOnboardingDestination: vi.fn()
}))
vi.mock('./transport/pairing', () => ({
  decodePairingUrl: vi.fn(),
  parsePairingCode: vi.fn(() => ({ testOffer: true }))
}))
vi.mock('./transport/pre-profile-pairing-coordinator', () => ({
  startPreProfilePairing: vi.fn(() => ({ result: new Promise(() => {}), dispose: vi.fn() }))
}))
vi.mock('./components/ConnectionLog', () => ({ ConnectionLog: () => null }))
vi.mock('./components/mounted-bottom-drawer', () => ({
  MountedBottomDrawer: ({ children }: { children: React.ReactNode }) => children
}))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.mocked(startPreProfilePairing).mockClear()
})

it('does not begin pairing from a queued paste submit after Cancel', async () => {
  act(() => {
    renderer = create(createElement(PairScanScreen))
  })
  act(() => renderer!.root.findAllByType('Pressable')[2]!.props.onPress())
  const input = () => renderer!.root.findByType('TextInput')
  act(() => input().props.onChangeText('orca://pair?code=valid'))
  const queuedSubmit = input().props.onSubmitEditing as () => void
  act(() => renderer!.root.findAllByType('Pressable').at(-2)!.props.onPress())
  expect(renderer!.root.findAllByType('TextInput')).toHaveLength(1)
  expect(input().props.value).toBe('orca://pair?code=valid')
  await act(async () => {
    queuedSubmit()
    await Promise.resolve()
  })
  expect(startPreProfilePairing).not.toHaveBeenCalled()
})
