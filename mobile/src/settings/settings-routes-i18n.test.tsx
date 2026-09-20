import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserSettingsScreen from '../../app/browser-settings'
import NativeChatSettingsScreen from '../../app/native-chat-settings'
import TerminalSettingsScreen from '../../app/terminal-settings'
import { CustomKeyModal } from '../components/CustomKeyModal'
import { i18n } from '../i18n/i18n'

const dependencies = vi.hoisted(() => ({
  back: vi.fn(),
  loadHosts: vi.fn(),
  loadTerminalAutocompleteEnabled: vi.fn(),
  loadTerminalLinkOpenMode: vi.fn(),
  loadTerminalTextScale: vi.fn(),
  saveTerminalAutocompleteEnabled: vi.fn(),
  saveTerminalLinkOpenMode: vi.fn(),
  saveTerminalTextScale: vi.fn(),
  setDefaultView: vi.fn()
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    AppState: {
      addEventListener: () => ({ remove: vi.fn() })
    },
    Platform: { OS: 'ios', select: (choices: Record<string, unknown>) => choices.ios },
    Pressable: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Pressable', props, children),
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Switch: 'Switch',
    Text: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Text', props, children),
    TextInput: 'TextInput',
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children)
  }
})

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('react-native-gesture-handler', async () => {
  const React = await import('react')
  return {
    GestureHandlerRootView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('GestureHandlerRootView', props, children)
  }
})

vi.mock('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (Component: unknown) => Component
  },
  useAnimatedRef: () => ({ current: { setNativeProps: vi.fn() } }),
  useAnimatedScrollHandler: (handler: unknown) => handler,
  useSharedValue: (value: unknown) => ({ value })
}))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(effect, [effect])
    },
    useRouter: () => ({ back: dependencies.back })
  }
})

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Globe: 'Globe',
  Smartphone: 'Smartphone',
  Type: 'Type',
  X: 'X'
}))

vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ children, visible }: { children?: ReactNode; visible: boolean }) =>
      visible ? React.createElement('BottomDrawer', null, children) : null
  }
})

vi.mock('../components/DragReorderList', async () => {
  const React = await import('react')
  return {
    DragReorderList: ({
      items,
      itemKey,
      renderRow
    }: {
      items: unknown[]
      itemKey: (item: unknown) => string
      renderRow: (item: unknown) => ReactNode
    }) =>
      React.createElement(
        'DragReorderList',
        null,
        items.map((item) =>
          React.createElement('DragReorderRow', { key: itemKey(item) }, renderRow(item))
        )
      )
  }
})

vi.mock('../storage/preferences', () => ({
  loadTerminalAutocompleteEnabled: dependencies.loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode: dependencies.loadTerminalLinkOpenMode,
  loadTerminalTextScale: dependencies.loadTerminalTextScale,
  saveTerminalAutocompleteEnabled: dependencies.saveTerminalAutocompleteEnabled,
  saveTerminalLinkOpenMode: dependencies.saveTerminalLinkOpenMode,
  saveTerminalTextScale: dependencies.saveTerminalTextScale
}))

vi.mock('../transport/host-store', () => ({
  loadHosts: dependencies.loadHosts
}))

vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: [] })
}))

vi.mock('../session/use-mobile-default-session-view-preference', () => ({
  useMobileDefaultSessionViewPreference: () => ({
    defaultView: 'chat',
    setDefaultView: dependencies.setDefaultView
  })
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined)
  }
}))

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('settings route did not render')
  }
  return renderer
}

function textValues(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
}

describe('settings route i18n rendering', () => {
  beforeEach(async () => {
    dependencies.back.mockReset()
    dependencies.loadHosts.mockReset().mockResolvedValue([])
    dependencies.loadTerminalAutocompleteEnabled.mockReset().mockResolvedValue(true)
    dependencies.loadTerminalLinkOpenMode.mockReset().mockResolvedValue('phone-browser')
    dependencies.loadTerminalTextScale.mockReset().mockResolvedValue(1)
    dependencies.saveTerminalAutocompleteEnabled.mockReset().mockResolvedValue(undefined)
    dependencies.saveTerminalLinkOpenMode.mockReset().mockResolvedValue(undefined)
    dependencies.saveTerminalTextScale.mockReset().mockResolvedValue(undefined)
    dependencies.setDefaultView.mockReset()
    await i18n.changeLanguage('zh')
  })

  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders terminal settings and shortcut leaf copy in Chinese', async () => {
    const renderer = await render(createElement(TerminalSettingsScreen))

    expect(textValues(renderer)).toEqual(
      expect.arrayContaining([
        '终端',
        '离开应用时',
        '还没有已配对的桌面端。配对后即可控制终端行为。',
        '文字大小',
        '默认（100%）',
        '键盘输入',
        '自动补全与自动纠错',
        '开启',
        '快捷键栏',
        '恢复默认',
        '自定义快捷键',
        '添加自定义快捷键...'
      ])
    )

    act(() => renderer.unmount())
  })

  it('renders browser settings link copy in Chinese', async () => {
    const renderer = await render(createElement(BrowserSettingsScreen))

    expect(textValues(renderer)).toEqual(
      expect.arrayContaining(['浏览器', '链接', '打开终端链接', '手机浏览器'])
    )

    act(() => renderer.unmount())
  })

  it('renders native chat settings copy in Chinese', async () => {
    const renderer = await render(createElement(NativeChatSettingsScreen))

    expect(textValues(renderer)).toEqual(
      expect.arrayContaining(['Chat UI', '默认视图', '在 Chat UI 中打开会话', '开启'])
    )

    act(() => renderer.unmount())
  })

  it('renders the custom shortcut modal leaf copy in Chinese', async () => {
    const renderer = await render(
      createElement(CustomKeyModal, {
        visible: true,
        onClose: vi.fn(),
        onKeysChanged: vi.fn()
      })
    )

    expect(textValues(renderer)).toEqual(
      expect.arrayContaining(['添加快捷键', '组合快捷键', '文字宏', '发送自定义文字命令'])
    )

    const textMacroRow = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.findAllByType('Text').some((text) => text.props.children === '文字宏'))
    if (!textMacroRow) {
      throw new Error('text macro row not found')
    }
    act(() => textMacroRow.props.onPress())

    expect(textValues(renderer)).toEqual(expect.arrayContaining(['标签', '命令', '添加快捷键']))

    act(() => renderer.unmount())
  })
})
