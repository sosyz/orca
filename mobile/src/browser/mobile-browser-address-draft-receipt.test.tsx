import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Monitor: 'Monitor',
  RefreshCw: 'RefreshCw',
  Smartphone: 'Smartphone'
}))

function pendingGoto() {
  let resolve!: (response: unknown) => void
  const promise = new Promise<unknown>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MobileBrowserPane address draft during an in-flight goto', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount() {
    const goto = pendingGoto()
    const sendRequest = vi.fn().mockReturnValue(goto.promise)
    const client = { subscribe: () => vi.fn(), sendRequest } as unknown as RpcClient
    const tab: MobileBrowserTab = {
      type: 'browser',
      id: 'tab-address',
      title: 'Dashboard',
      browserWorkspaceId: 'bw-address',
      browserPageId: 'page-address',
      url: 'https://dashboard.example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      isActive: true
    }
    const props = {
      client,
      pairedHostId: 'host-address',
      worktreeId: 'worktree-address',
      tab,
      screencastSupported: true,
      keyboardLift: 0,
      bottomInset: 0,
      active: true,
      onToast: vi.fn()
    }
    await act(async () => {
      renderer = create(createElement(MobileBrowserPane, props))
      await Promise.resolve()
    })
    const address = () =>
      renderer!.root.findAllByType('TextInput').find((node) => node.props.placeholder === 'URL')!
    const invalidUrlVisible = () =>
      renderer!.root
        .findAllByType('Text')
        .some((node) => node.children.join('').includes('Enter a valid URL.'))
    act(() => address().props.onFocus())
    act(() => address().props.onChangeText('first.example'))
    act(() => address().props.onSubmitEditing())
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(address().props.editable).toBe(true)
    const replaceClient = async (nextClient: RpcClient) => {
      await act(async () => {
        renderer!.update(createElement(MobileBrowserPane, { ...props, client: nextClient }))
      })
    }
    return { address, goto, invalidUrlVisible, replaceClient, sendRequest }
  }

  it('keeps an unsubmitted B draft when A succeeds', async () => {
    const { address, goto } = await mount()
    act(() => address().props.onChangeText('second.example'))
    await act(async () => goto.resolve({ ok: true, result: { url: 'https://first.example/' } }))
    expect(address().props.value).toBe('second.example')
  })

  it('keeps an invalid submitted B draft when A succeeds', async () => {
    const { address, goto, sendRequest } = await mount()
    act(() => address().props.onChangeText('javascript:alert(1)'))
    act(() => address().props.onSubmitEditing())
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => goto.resolve({ ok: true, result: { url: 'https://first.example/' } }))
    expect(address().props.value).toBe('javascript:alert(1)')
  })

  it('keeps invalid B feedback when the earlier valid goto succeeds', async () => {
    const { address, goto, invalidUrlVisible } = await mount()
    act(() => address().props.onChangeText('javascript:alert(1)'))
    act(() => address().props.onSubmitEditing())
    expect(invalidUrlVisible()).toBe(true)
    await act(async () => goto.resolve({ ok: true, result: { url: 'https://first.example/' } }))
    expect(invalidUrlVisible()).toBe(true)
  })

  it('keeps a newly edited same-text draft after A to B to A', async () => {
    const { address, goto } = await mount()
    act(() => address().props.onChangeText('second.example'))
    act(() => address().props.onChangeText('first.example'))
    await act(async () => goto.resolve({ ok: true, result: { url: 'https://first.example/' } }))
    expect(address().props.value).toBe('first.example')
  })

  it('an old client’s submit callback cannot retire the new client’s failed goto', async () => {
    const { address, goto, replaceClient } = await mount()
    await act(async () => goto.resolve({ ok: true, result: { url: 'https://first.example/' } }))
    const staleSubmit = address().props.onSubmitEditing
    const next = pendingGoto()
    const nextSendRequest = vi.fn().mockReturnValue(next.promise)
    await replaceClient({
      subscribe: () => vi.fn(),
      sendRequest: nextSendRequest
    } as unknown as RpcClient)
    act(() => address().props.onChangeText('second.example'))
    act(() => address().props.onSubmitEditing())
    expect(nextSendRequest).toHaveBeenCalledTimes(1)
    act(() => staleSubmit())
    await act(async () => next.resolve({ ok: false, error: { message: 'B navigation failed' } }))
    expect(
      renderer!.root
        .findAllByType('Text')
        .some((node) => node.children.join('').includes('B navigation failed'))
    ).toBe(true)
    expect(nextSendRequest).toHaveBeenCalledTimes(1)
  })
})
