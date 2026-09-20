import { Buffer } from 'buffer'
import { createElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_LANGUAGE_CHINESE, UI_LANGUAGE_ENGLISH } from '../../../src/shared/ui-language'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../transport/browser-screencast-protocol'
import type { RpcClient } from '../transport/rpc-client'
import { changeMobileUiLanguage, i18n } from '../i18n/i18n'
import { createMobileBrowserCopy } from './mobile-browser-copy'
import { MobileBrowserPane, type MobileBrowserTab } from './MobileBrowserPane'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Image: 'Image',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  PixelRatio: { get: () => 2 },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  TextInput: 'TextInput',
  TurboModuleRegistry: { get: vi.fn(() => null) },
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Monitor: 'Monitor',
  RefreshCw: 'RefreshCw',
  Smartphone: 'Smartphone'
}))

type Subscription = {
  listener: (payload: unknown) => void
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

type NativeImageMock = {
  currentUri: string | null
  setNativeProps: ReturnType<typeof vi.fn>
}

const tab: MobileBrowserTab = {
  browserPageId: 'browser-page-i18n',
  browserWorkspaceId: 'browser-workspace-i18n',
  canGoBack: true,
  canGoForward: true,
  id: 'browser-tab-i18n',
  isActive: true,
  loading: false,
  title: 'Dashboard',
  type: 'browser',
  url: 'https://dashboard.example'
}

afterEach(async () => {
  await changeMobileUiLanguage(UI_LANGUAGE_ENGLISH, 'en-US')
})

function makeFrame(label = 'frame'): BrowserScreencastFrame {
  return {
    format: 'jpeg',
    image: new TextEncoder().encode(label),
    metadata: { deviceHeight: 640, deviceWidth: 360, pageScaleFactor: 1 },
    opcode: BrowserScreencastOpcode.Frame,
    seq: 1
  }
}

function frameUri(label: string): string {
  return `data:image/jpeg;base64,${Buffer.from(label).toString('base64')}`
}

function makeClient() {
  const subscriptions: Subscription[] = []
  const client = {
    request: vi.fn(),
    sendRequest: vi.fn(async () => ({ ok: true, result: {} })),
    subscribe: vi.fn(
      (
        _method: string,
        _params: unknown,
        listener: (payload: unknown) => void,
        options?: { onBinaryFrame?: (frame: BrowserScreencastFrame) => void }
      ) => {
        const unsubscribe = vi.fn()
        subscriptions.push({ listener, onBinaryFrame: options?.onBinaryFrame, unsubscribe })
        return unsubscribe
      }
    )
  } as unknown as RpcClient & { subscribe: ReturnType<typeof vi.fn> }
  return { client, subscriptions }
}

function readNativeSourceUri(value: unknown): string | null {
  const source = value && typeof value === 'object' ? (value as { source?: unknown }).source : null
  if (!Array.isArray(source)) {
    return null
  }
  const first = source[0]
  const uri = first && typeof first === 'object' ? (first as { uri?: unknown }).uri : null
  return typeof uri === 'string' ? uri : null
}

function nativeImageUris(imageMocks: NativeImageMock[]): string[] {
  return imageMocks
    .map((image) => image.currentUri)
    .filter((uri): uri is string => typeof uri === 'string')
}

function labels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Pressable')
    .map((node) => node.props.accessibilityLabel)
    .filter((label): label is string => typeof label === 'string')
}

function placeholders(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('TextInput')
    .map((node) => node.props.placeholder)
    .filter((placeholder): placeholder is string => typeof placeholder === 'string')
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .filter(Boolean)
}

async function renderPane({
  client,
  screencastSupported
}: {
  client: RpcClient | null
  screencastSupported: boolean | null
}) {
  const imageMocks: NativeImageMock[] = []
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MobileBrowserPane, {
          active: true,
          bottomInset: 0,
          client,
          keyboardLift: 0,
          onToast: () => {},
          pairedHostId: 'host-i18n',
          screencastSupported,
          tab,
          worktreeId: 'worktree-i18n'
        })
      ),
      {
        createNodeMock: (element) => {
          if (element.type === 'Image') {
            const image: NativeImageMock = {
              currentUri: null,
              setNativeProps: vi.fn((props: unknown) => {
                const uri = readNativeSourceUri(props)
                if (uri) {
                  image.currentUri = uri
                }
              })
            }
            imageMocks.push(image)
            return image
          }
          return { setNativeProps: vi.fn() }
        }
      }
    )
    await Promise.resolve()
  })
  return { imageMocks, renderer }
}

function layoutBrowserViewport(renderer: ReactTestRenderer): void {
  const viewport = renderer.root
    .findAllByType('View')
    .find((node) => typeof node.props.onLayout === 'function')
  if (!viewport) {
    throw new Error('Browser viewport not found')
  }
  act(() => {
    viewport.props.onLayout({ nativeEvent: { layout: { height: 640, width: 360 } } })
  })
}

function loadImageFrame(renderer: ReactTestRenderer, label: string): void {
  renderer.root
    .findAllByType('Image')[0]
    .props.onLoad({ nativeEvent: { source: { uri: frameUri(label) } } })
}

describe('mobile browser i18n', () => {
  it('renders browser chrome and fallback copy in English and Chinese', async () => {
    await changeMobileUiLanguage(UI_LANGUAGE_ENGLISH, 'zh-CN')
    const english = createMobileBrowserCopy((key, options) => i18n.t(key, options))
    const englishPane = await renderPane({ client: null, screencastSupported: false })

    expect(labels(englishPane.renderer)).toEqual(
      expect.arrayContaining([
        'Back',
        'Forward',
        'Reload',
        'Show desktop website view',
        'Show mobile website view',
        'Cmd click modifier',
        'Send text to browser'
      ])
    )
    expect(placeholders(englishPane.renderer)).toEqual(
      expect.arrayContaining(['URL', 'Type on page…'])
    )
    expect(texts(englishPane.renderer)).toContain(
      'Update desktop Orca to stream browser tabs on mobile.'
    )
    expect(english.toasts).toEqual({ rightClick: 'Right click', sent: 'Sent' })

    await act(async () => {
      englishPane.renderer.unmount()
    })
    await changeMobileUiLanguage(UI_LANGUAGE_CHINESE, 'en-US')
    const chinese = createMobileBrowserCopy((key, options) => i18n.t(key, options))
    const chinesePane = await renderPane({ client: null, screencastSupported: false })

    expect(labels(chinesePane.renderer)).toEqual(
      expect.arrayContaining([
        '后退',
        '前进',
        '重新加载',
        '显示桌面网页视图',
        '显示移动网页视图',
        'Cmd 点击修饰键',
        '发送文本到浏览器'
      ])
    )
    expect(placeholders(chinesePane.renderer)).toEqual(
      expect.arrayContaining(['输入 URL', '在页面输入…'])
    )
    expect(texts(chinesePane.renderer)).toContain('请更新桌面端 Orca，以在移动端串流浏览器标签页。')
    expect(chinese.toasts).toEqual({ rightClick: '右键点击', sent: '已发送' })
  })

  it('does not restart an active screencast when the UI language changes', async () => {
    await changeMobileUiLanguage(UI_LANGUAGE_ENGLISH, 'en-US')
    const { client, subscriptions } = makeClient()
    const { imageMocks, renderer } = await renderPane({ client, screencastSupported: true })
    layoutBrowserViewport(renderer)

    expect(client.subscribe).toHaveBeenCalledTimes(1)
    act(() => {
      subscriptions[0].onBinaryFrame?.(makeFrame('visible-before-language-change'))
    })
    act(() => {
      loadImageFrame(renderer, 'visible-before-language-change')
    })
    expect(nativeImageUris(imageMocks)).toContain(frameUri('visible-before-language-change'))

    await act(async () => {
      await changeMobileUiLanguage(UI_LANGUAGE_CHINESE, 'en-US')
      await Promise.resolve()
    })

    expect(client.subscribe).toHaveBeenCalledTimes(1)
    expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled()
    expect(nativeImageUris(imageMocks)).toContain(frameUri('visible-before-language-change'))
    expect(placeholders(renderer)).toContain('在页面输入…')
  })
})
