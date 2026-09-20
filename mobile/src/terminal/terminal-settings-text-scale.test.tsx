import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalSettingsScreen from '../../app/terminal-settings'

const deps = vi.hoisted(() => ({
  loadTextScale: vi.fn(),
  saveTextScale: vi.fn()
}))

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, text: string) => text })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 })
}))
vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView'
}))
vi.mock('react-native-reanimated', () => ({
  useAnimatedRef: () => ({ current: null }),
  useAnimatedScrollHandler: (handler: unknown) => handler,
  useSharedValue: (value: unknown) => ({ value })
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Smartphone: 'Smartphone',
  Type: 'Type'
}))
vi.mock('../components/reanimated-scroll-view', () => ({ ReanimatedScrollView: 'ScrollView' }))
vi.mock('../components/PickerModal', () => ({ PickerModal: 'PickerModal' }))
vi.mock('../components/TerminalShortcutSettings', () => ({ TerminalShortcutSettings: 'Shortcuts' }))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [] }))
vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: [] })
}))
vi.mock('../storage/preferences', () => ({
  loadTerminalAutocompleteEnabled: async () => false,
  loadTerminalTextScale: deps.loadTextScale,
  saveTerminalAutocompleteEnabled: vi.fn(),
  saveTerminalTextScale: deps.saveTextScale
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('terminal text size setting', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    deps.loadTextScale.mockReset().mockResolvedValue(1)
    deps.saveTextScale.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render() {
    await act(async () => {
      renderer = create(createElement(TerminalSettingsScreen))
      await Promise.resolve()
    })
  }
  function textValues() {
    return renderer!.root.findAllByType('Text').map((node) => node.children.join(''))
  }
  async function selectTextSize(value: string) {
    const row = renderer!.root
      .findAllByType('Text')
      .find((node) => node.children[0] === 'Text size')
    if (!row) {
      throw new Error('Missing text size row')
    }
    await act(async () => row.parent!.parent!.props.onPress())
    const picker = renderer!.root.findAllByType('PickerModal')[1]!
    expect(picker.props.visible).toBe(true)
    await act(async () => {
      picker.props.onSelect(value)
      picker.props.onClose()
    })
  }

  it('does not let the initial read overwrite a newer selection', async () => {
    const read = deferred<number>()
    deps.loadTextScale.mockReturnValue(read.promise)
    await render()
    expect(textValues()).toContain('Default (100%)')

    await selectTextSize('large')
    expect(deps.saveTextScale).toHaveBeenCalledExactlyOnceWith(1.25)
    expect(textValues()).toContain('Large (125%)')

    await act(async () => {
      read.resolve(0.75)
      await read.promise
    })
    expect(textValues()).toContain('Large (125%)')
    expect(textValues()).not.toContain('Smaller (75%)')
  })

  it('uses a loaded preference when there is no newer selection', async () => {
    deps.loadTextScale.mockResolvedValue(0.75)
    await render()
    expect(textValues()).toContain('Smaller (75%)')
  })
})
