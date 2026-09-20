import { Buffer } from 'buffer'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../transport/browser-screencast-protocol'
import type { RpcClient } from '../transport/rpc-client'
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
  View: 'View'
}))

// Why: covers icons reached transitively too (the view-mode switch), not just the pane's own
// imports — vitest throws on the first unmocked export rather than rendering without it.
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

let pageCounter = 0
const renderedPanes: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderedPanes.splice(0).forEach((pane) => pane.unmount()))
  vi.useRealTimers()
})

function makeFrame(label = 'frame'): BrowserScreencastFrame {
  return {
    opcode: BrowserScreencastOpcode.Frame,
    seq: 1,
    format: 'jpeg',
    metadata: { deviceWidth: 360, deviceHeight: 640, pageScaleFactor: 1 },
    image: new TextEncoder().encode(label)
  }
}

function frameUri(label: string): string {
  return `data:image/jpeg;base64,${Buffer.from(label).toString('base64')}`
}

function spinnerCount(renderer: ReactTestRenderer): number {
  return renderer.root.findAllByType('ActivityIndicator').length
}

function keyboardInputEditable(renderer: ReactTestRenderer): boolean | undefined {
  return renderer.root
    .findAllByType('TextInput')
    .find((node) => node.props.placeholder === 'Type on page…')?.props.editable
}

function loadImageFrame(renderer: ReactTestRenderer, label: string, layer = 0): void {
  renderer.root
    .findAllByType('Image')
    [layer].props.onLoad({ nativeEvent: { source: { uri: frameUri(label) } } })
}

type NativeImageMock = {
  currentUri: string | null
  setNativeProps: ReturnType<typeof vi.fn>
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

type PaneRenderOptions = {
  active?: boolean
  pairedHostId?: string
  worktreeId?: string
  tabId?: string
  browserPageId?: string
}

function createPaneElement(
  client: RpcClient,
  tab: MobileBrowserTab,
  options: Required<Pick<PaneRenderOptions, 'pairedHostId' | 'worktreeId'>> &
    Pick<PaneRenderOptions, 'active'>
) {
  return createElement(MobileBrowserPane, {
    client,
    pairedHostId: options.pairedHostId,
    worktreeId: options.worktreeId,
    tab,
    screencastSupported: true,
    keyboardLift: 0,
    bottomInset: 0,
    active: options.active,
    onToast: () => {}
  })
}

async function renderPane(options: PaneRenderOptions = {}): Promise<{
  client: RpcClient
  imageMocks: NativeImageMock[]
  renderer: ReactTestRenderer
  stream: Subscription
  streams: Subscription[]
  tab: MobileBrowserTab
  worktreeId: string
}> {
  pageCounter += 1
  const subscriptions: Subscription[] = []
  const client = {
    subscribe: (
      _method: string,
      _params: unknown,
      listener: (payload: unknown) => void,
      options?: { onBinaryFrame?: (frame: BrowserScreencastFrame) => void }
    ) => {
      const unsubscribe = vi.fn()
      subscriptions.push({ listener, onBinaryFrame: options?.onBinaryFrame, unsubscribe })
      return unsubscribe
    },
    sendRequest: vi.fn().mockResolvedValue({ ok: true, result: {} })
  } as unknown as RpcClient

  const imageMocks: NativeImageMock[] = []
  const tab: MobileBrowserTab = {
    type: 'browser',
    id: options.tabId ?? `tab-${pageCounter}`,
    title: 'Dashboard',
    browserWorkspaceId: 'bw-1',
    browserPageId: options.browserPageId ?? `page-${pageCounter}`,
    url: 'https://dashboard.example',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    isActive: true
  }

  let renderer: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createPaneElement(client, tab, {
        active: options.active ?? true,
        pairedHostId: options.pairedHostId ?? `host-${pageCounter}`,
        // Why: unique worktree id keeps each test on a cold module-level frame cache.
        worktreeId: options.worktreeId ?? `wt-${pageCounter}`
      }),
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
  const mounted: ReactTestRenderer = renderer
  renderedPanes.push(mounted)
  const viewport = mounted.root
    .findAllByType('View')
    .find((node) => typeof node.props.onLayout === 'function')
  if (!viewport) {
    throw new Error('Viewport with onLayout not found')
  }
  act(() => {
    viewport.props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } })
  })
  const stream = subscriptions[0]
  if (!stream) {
    throw new Error('browser.screencast subscription not created')
  }
  return {
    client,
    imageMocks,
    renderer: mounted,
    stream,
    streams: subscriptions,
    tab,
    worktreeId: options.worktreeId ?? `wt-${pageCounter}`
  }
}

describe('MobileBrowserPane with a stream that reports ready but sends no frames', () => {
  // Why: a host that stops painting still reports `ready`, so the pane used to clear its
  // indicator and leave an unexplained black rectangle.
  it('keeps showing the loading indicator instead of an empty black pane', async () => {
    const { renderer, stream } = await renderPane()

    act(() => {
      stream.listener({ type: 'ready', tab: { url: 'https://dashboard.example' } })
    })

    expect(spinnerCount(renderer)).toBeGreaterThan(0)
  })

  it('clears the indicator once real pixels arrive', async () => {
    const { imageMocks, renderer, stream } = await renderPane()

    act(() => {
      stream.listener({ type: 'ready', tab: { url: 'https://dashboard.example' } })
    })
    act(() => {
      stream.onBinaryFrame?.(makeFrame())
    })
    act(() => {
      loadImageFrame(renderer, 'frame')
    })

    expect(spinnerCount(renderer)).toBe(0)
    const source = nativeImageUris(imageMocks)[0]
    expect(source).toContain(Buffer.from(makeFrame().image).toString('base64'))
  })

  it('reuses a cached frame when the same host page remounts', async () => {
    const options = {
      pairedHostId: 'paired-cache-host',
      worktreeId: 'repo::/cache-worktree',
      browserPageId: 'browser-page-cache'
    }
    const first = await renderPane(options)
    const cachedFrame = makeFrame('same-host-cache')

    act(() => {
      first.stream.onBinaryFrame?.(cachedFrame)
    })
    act(() => {
      loadImageFrame(first.renderer, 'same-host-cache')
    })
    act(() => {
      first.renderer.unmount()
    })

    const second = await renderPane({ ...options, tabId: 'tab-cache-remount' })

    expect(nativeImageUris(second.imageMocks).join('\n')).toContain(
      Buffer.from(cachedFrame.image).toString('base64')
    )
  })

  it('keeps retained-frame page input disabled until the current stream commits a frame', async () => {
    const options = {
      pairedHostId: 'paired-input-host',
      worktreeId: 'repo::/input-worktree',
      browserPageId: 'browser-page-input'
    }
    const first = await renderPane(options)

    act(() => {
      first.stream.onBinaryFrame?.(makeFrame('input-cache'))
    })
    act(() => {
      loadImageFrame(first.renderer, 'input-cache')
    })
    act(() => {
      first.renderer.unmount()
    })

    const second = await renderPane({ ...options, tabId: 'tab-input-remount' })

    expect(keyboardInputEditable(second.renderer)).toBe(false)

    act(() => {
      second.stream.onBinaryFrame?.(makeFrame('input-fresh'))
    })
    act(() => {
      second.renderer.root.findAllByType('Image')[1].props.onLoad({
        nativeEvent: { source: { uri: frameUri('input-fresh') } }
      })
    })

    expect(keyboardInputEditable(second.renderer)).toBe(true)
  })

  it('resets rendered image layers when the same page switches paired hosts', async () => {
    const first = await renderPane({
      pairedHostId: 'paired-host-a',
      worktreeId: 'repo::/shared-worktree',
      browserPageId: 'browser-page-shared'
    })
    const oldFrame = makeFrame('host-a-only')

    act(() => {
      first.stream.onBinaryFrame?.(oldFrame)
    })
    act(() => {
      loadImageFrame(first.renderer, 'host-a-only')
    })

    expect(nativeImageUris(first.imageMocks).join('\n')).toContain(
      Buffer.from(oldFrame.image).toString('base64')
    )

    act(() => {
      first.renderer.update(
        createPaneElement(first.client, first.tab, {
          pairedHostId: 'paired-host-b',
          worktreeId: first.worktreeId
        })
      )
    })

    expect(first.renderer.root.findAllByType('Image')).toHaveLength(0)
    expect(spinnerCount(first.renderer)).toBeGreaterThan(0)
  })

  it('stops the stream while inactive without dropping the retained frame', async () => {
    const options = {
      pairedHostId: 'paired-active-host',
      worktreeId: 'repo::/active-worktree',
      browserPageId: 'browser-page-active'
    }
    const pane = await renderPane(options)
    const retainedFrame = makeFrame('retained-while-inactive')

    act(() => {
      pane.stream.onBinaryFrame?.(retainedFrame)
    })
    act(() => {
      loadImageFrame(pane.renderer, 'retained-while-inactive')
    })

    expect(nativeImageUris(pane.imageMocks).join('\n')).toContain(
      Buffer.from(retainedFrame.image).toString('base64')
    )

    await act(async () => {
      pane.renderer.update(
        createPaneElement(pane.client, pane.tab, {
          active: false,
          pairedHostId: options.pairedHostId,
          worktreeId: options.worktreeId
        })
      )
      await Promise.resolve()
    })

    expect(pane.stream.unsubscribe).toHaveBeenCalledTimes(1)
    expect(pane.renderer.root.findAllByType('Image').length).toBeGreaterThan(0)
  })
})

describe('MobileBrowserPane first painted frame lifecycle', () => {
  it('times out when ready is not followed by pixels', async () => {
    vi.useFakeTimers()
    const { renderer, stream } = await renderPane()
    act(() => stream.listener({ type: 'ready' }))
    act(() => vi.advanceTimersByTime(15_000))
    expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream timed out.')
    expect(spinnerCount(renderer)).toBe(0)
  })

  it.each(['failed', 'stalled'])(
    'times out a %s first image decode and accepts recovery',
    async (decode) => {
      vi.useFakeTimers()
      const { renderer, stream } = await renderPane()
      act(() => stream.listener({ type: 'ready' }))
      act(() => stream.onBinaryFrame?.(makeFrame('broken')))
      expect(spinnerCount(renderer)).toBeGreaterThan(0)
      if (decode === 'failed') {
        act(() =>
          renderer.root.findAllByType('Image')[0].props.onError({
            nativeEvent: { source: { uri: frameUri('broken') } }
          })
        )
      }
      act(() => vi.advanceTimersByTime(15_000))
      expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream timed out.')
      act(() => stream.onBinaryFrame?.(makeFrame('recovered')))
      act(() => loadImageFrame(renderer, 'recovered'))
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Browser stream timed out.')
      expect(keyboardInputEditable(renderer)).toBe(true)
      expect(spinnerCount(renderer)).toBe(0)
    }
  )

  it('finishes loading on the first painted frame even without a ready event', async () => {
    vi.useFakeTimers()
    const { renderer, stream } = await renderPane()
    act(() => stream.onBinaryFrame?.(makeFrame('painted')))
    act(() => loadImageFrame(renderer, 'painted'))
    expect(spinnerCount(renderer)).toBe(0)
    act(() => vi.advanceTimersByTime(15_000))
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Browser stream timed out.')
  })

  it('ignores late stream callbacks after unmount', async () => {
    vi.useFakeTimers()
    const { renderer, stream } = await renderPane()
    act(() => renderer.unmount())
    act(() => {
      stream.onBinaryFrame?.(makeFrame('late-1'))
      stream.onBinaryFrame?.(makeFrame('late-2'))
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows a stopped stream, rejects late frames, and reconnects on reload', async () => {
    vi.useFakeTimers()
    const { renderer, stream, streams } = await renderPane()
    act(() => stream.listener({ type: 'ready' }))
    act(() => stream.listener({ type: 'end' }))
    act(() => stream.onBinaryFrame?.(makeFrame('too-late')))
    expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream failed.')
    expect(spinnerCount(renderer)).toBe(0)
    expect(keyboardInputEditable(renderer)).toBe(false)
    expect(renderer.root.findAllByType('Image')).toHaveLength(0)
    await act(async () => {
      renderer.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'Reload')!
        .props.onPress()
    })
    expect(stream.unsubscribe).toHaveBeenCalledOnce()
    expect(streams).toHaveLength(2)
    act(() => streams[1].onBinaryFrame?.(makeFrame('restart')))
    act(() => loadImageFrame(renderer, 'restart'))
    expect(spinnerCount(renderer)).toBe(0)
    expect(keyboardInputEditable(renderer)).toBe(true)
  })

  it('keeps a stream error when a later command succeeds with the same error text', async () => {
    const { client, renderer, stream } = await renderPane()
    const sendRequest = client.sendRequest as ReturnType<typeof vi.fn>
    let resolveLatest!: (response: { ok: true; result: object }) => void
    sendRequest
      .mockImplementationOnce(async () => ({
        ok: false,
        error: { message: 'Browser stream failed.' }
      }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve
          })
      )
    const address = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.placeholder === 'URL')!
    await act(async () => {
      address.props.onSubmitEditing()
      await Promise.resolve()
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream failed.')

    act(() => {
      address.props.onSubmitEditing()
      stream.listener({ type: 'end' })
    })
    await act(async () => {
      resolveLatest({ ok: true, result: {} })
      await Promise.resolve()
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream failed.')
  })

  it('keeps the first frame deadline after a suppressed selector error', async () => {
    vi.useFakeTimers()
    const { renderer, stream } = await renderPane()
    act(() => stream.listener({ type: 'error', message: 'selector_not_found' }))
    act(() => vi.advanceTimersByTime(15_000))
    expect(JSON.stringify(renderer.toJSON())).toContain('Browser stream timed out.')
  })

  it('ignores malformed stream events', async () => {
    const { stream } = await renderPane()
    expect(() => act(() => stream.listener(null))).not.toThrow()
  })

  it.each(['new draft', 'cleared and restored to empty'])(
    'keeps keyboard edits while an old send fails: %s',
    async (edit) => {
      const { client, renderer, stream } = await renderPane()
      act(() => stream.onBinaryFrame?.(makeFrame('keyboard')))
      act(() => loadImageFrame(renderer, 'keyboard'))
      const keyboard = () =>
        renderer.root
          .findAllByType('TextInput')
          .find((node) => node.props.placeholder === 'Type on page…')!
      let resolve!: (response: unknown) => void
      const sendRequest = client.sendRequest as ReturnType<typeof vi.fn>
      sendRequest.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      act(() => keyboard().props.onChangeText('old text'))
      act(() => keyboard().props.onSubmitEditing())
      act(() => {
        keyboard().props.onChangeText('new draft')
        if (edit !== 'new draft') {
          keyboard().props.onChangeText('')
        }
      })
      await act(async () => {
        resolve({ ok: false, error: { code: 'internal_error', message: 'Insert failed' } })
      })
      expect(keyboard().props.value).toBe(edit === 'new draft' ? 'new draft' : '')
    }
  )

  it('submits keyboard text only once when native return and Send fire in the same batch', async () => {
    const { client, renderer, stream } = await renderPane()
    act(() => stream.onBinaryFrame?.(makeFrame('keyboard-double')))
    act(() => loadImageFrame(renderer, 'keyboard-double'))
    const keyboard = () =>
      renderer.root
        .findAllByType('TextInput')
        .find((node) => node.props.placeholder === 'Type on page…')!
    act(() => keyboard().props.onChangeText('once'))
    const submit = keyboard().props.onSubmitEditing
    await act(async () => {
      submit()
      submit()
    })
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('restores a rejected unchanged keyboard draft but not a successful superseded send', async () => {
    const { client, renderer, stream } = await renderPane()
    act(() => stream.onBinaryFrame?.(makeFrame('keyboard-accepted')))
    act(() => loadImageFrame(renderer, 'keyboard-accepted'))
    const keyboard = () =>
      renderer.root
        .findAllByType('TextInput')
        .find((node) => node.props.placeholder === 'Type on page…')!
    const sendRequest = client.sendRequest as ReturnType<typeof vi.fn>
    sendRequest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal_error', message: 'Insert failed' }
    })
    act(() => keyboard().props.onChangeText('retained'))
    await act(async () => keyboard().props.onSubmitEditing())
    expect(keyboard().props.value).toBe('retained')
    let resolve!: (response: unknown) => void
    sendRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    act(() => keyboard().props.onSubmitEditing())
    await act(async () => {
      renderer.root
        .findAllByType('TextInput')
        .find((node) => node.props.placeholder === 'URL')!
        .props.onSubmitEditing()
    })
    await act(async () => {
      resolve({ ok: true, result: {} })
    })
    expect(keyboard().props.value).toBe('')
  })

  it('keeps the latest submitted URL when an earlier same-page navigation succeeds late', async () => {
    const { client, renderer } = await renderPane()
    const address = () =>
      renderer.root.findAllByType('TextInput').find((node) => node.props.placeholder === 'URL')!
    const resolutions: ((response: unknown) => void)[] = []
    const sendRequest = client.sendRequest as ReturnType<typeof vi.fn>
    sendRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolutions.push(resolve)
        })
    )
    act(() => address().props.onChangeText('https://first.example'))
    act(() => address().props.onSubmitEditing())
    act(() => address().props.onChangeText('https://second.example'))
    act(() => address().props.onSubmitEditing())
    await act(async () => {
      resolutions[1]({ ok: true, result: { url: 'https://second.example' } })
    })
    await act(async () => {
      resolutions[0]({ ok: true, result: { url: 'https://first.example' } })
    })
    expect(address().props.value).toBe('https://second.example')
  })
})
