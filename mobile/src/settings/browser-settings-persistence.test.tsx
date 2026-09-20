import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import BrowserSettingsScreen from '../../app/browser-settings'
import {
  loadTerminalLinkOpenMode,
  saveTerminalLinkOpenMode,
  type MobileTerminalLinkOpenMode
} from '../storage/preferences'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Globe: 'Globe'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children, visible }: { children?: ReactNode; visible: boolean }) =>
    visible ? children : null
}))
vi.mock('../storage/preferences', () => ({
  loadTerminalLinkOpenMode: vi.fn(),
  saveTerminalLinkOpenMode: vi.fn()
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

it('keeps a link-mode choice when the initial storage read arrives later', async () => {
  const initialRead = deferred<MobileTerminalLinkOpenMode>()
  vi.mocked(loadTerminalLinkOpenMode).mockReturnValue(initialRead.promise)
  vi.mocked(saveTerminalLinkOpenMode).mockResolvedValue(undefined)
  act(() => {
    renderer = create(createElement(BrowserSettingsScreen))
  })

  act(() => renderer!.root.findAllByType('Pressable' as never)[1].props.onPress())
  const phoneOption = renderer!.root.findAllByType('Pressable' as never).at(-1)!
  act(() => phoneOption.props.onPress())
  expect(saveTerminalLinkOpenMode).toHaveBeenCalledWith('phone-browser')

  await act(async () => {
    initialRead.resolve('orca-browser')
    await initialRead.promise
  })

  const linkRow = renderer!.root.findAllByType('Pressable' as never)[1]
  expect(linkRow.findAllByType('Text' as never)[1].children.join('')).toBe('Phone browser')
})
