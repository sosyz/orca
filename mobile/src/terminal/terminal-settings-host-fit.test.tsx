import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalSettingsScreen from '../../app/terminal-settings'
import type { RpcResponse } from '../transport/types'

const deps = vi.hoisted(() => ({
  clients: [] as { hostId: string; client: { sendRequest: ReturnType<typeof vi.fn> } }[],
  alert: vi.fn()
}))

vi.mock('react-native', () => ({
  Alert: { alert: deps.alert },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, text: string, values?: { seconds?: number }) =>
      values?.seconds === undefined ? text : text.replace('{{seconds}}', String(values.seconds))
  })
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
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [{ id: 'host-a', name: 'Desk A' }]
}))
vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: deps.clients })
}))
vi.mock('../storage/preferences', () => ({
  loadTerminalAutocompleteEnabled: async () => false,
  loadTerminalTextScale: async () => 1,
  saveTerminalAutocompleteEnabled: vi.fn(),
  saveTerminalTextScale: vi.fn()
}))

const response = (ms: number | null): RpcResponse => ({
  id: 'rpc',
  ok: true,
  result: { ms },
  _meta: { runtimeId: 'runtime' }
})
const failure = (message: string): RpcResponse => ({
  id: 'rpc',
  ok: false,
  error: { code: 'unavailable', message },
  _meta: { runtimeId: 'runtime' }
})
function deferred() {
  let resolve!: (response: RpcResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RpcResponse>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

let renderer: ReactTestRenderer | null = null
async function render(sendRequest: ReturnType<typeof vi.fn>) {
  deps.clients = [{ hostId: 'host-a', client: { sendRequest } }]
  await act(async () => {
    renderer = create(createElement(TerminalSettingsScreen))
    await Promise.resolve()
  })
}
async function replaceClient(sendRequest: ReturnType<typeof vi.fn>) {
  deps.clients = [{ hostId: 'host-a', client: { sendRequest } }]
  await act(async () => {
    renderer!.update(createElement(TerminalSettingsScreen))
    await Promise.resolve()
  })
}
async function rebuildClientsMap() {
  deps.clients = [...deps.clients]
  await act(async () => {
    renderer!.update(createElement(TerminalSettingsScreen))
    await Promise.resolve()
  })
}
function textValues() {
  return renderer!.root.findAllByType('Text').map((node) => node.children.join(''))
}
async function select(value: string) {
  const rowText = renderer!.root.findAllByType('Text').find((node) => node.children[0] === 'Desk A')
  if (!rowText) {
    throw new Error('Missing host row')
  }
  await act(async () => {
    rowText.parent!.parent!.props.onPress()
  })
  const picker = renderer!.root.findAllByType('PickerModal')[0]!
  expect(picker.props.visible).toBe(true)
  await act(async () => {
    picker.props.onSelect(value)
    picker.props.onClose()
  })
}

beforeEach(() => {
  deps.alert.mockReset()
})
afterEach(async () => {
  if (renderer) {
    await act(async () => renderer!.unmount())
  }
  renderer = null
  deps.clients = []
})

describe('terminal auto-restore host setting', () => {
  it('reads the result envelope and preserves finite, null, and zero values', async () => {
    const sendRequest = vi.fn().mockResolvedValue(response(60_000))
    await render(sendRequest)
    expect(textValues()).toContain('After 1 minute')
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith('terminal.getAutoRestoreFit')

    await act(async () => renderer!.unmount())
    renderer = null
    await render(vi.fn().mockResolvedValue(response(null)))
    expect(textValues()).toContain('Keep at phone size (default)')

    await act(async () => renderer!.unmount())
    renderer = null
    await render(vi.fn().mockResolvedValue(response(0)))
    expect(textValues()).toContain('After 0s')
  })

  it('keeps the acknowledged host value after a successful selection', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(300_000))
    await render(sendRequest)
    await select('5m')
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'terminal.setAutoRestoreFit', {
      ms: 300_000
    })
    expect(textValues()).toContain('After 5 minutes')
  })

  it('rereads server truth and reports an ok:false mutation', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(60_000))
      .mockResolvedValueOnce(failure('Write rejected'))
      .mockResolvedValueOnce(response(60_000))
    await render(sendRequest)
    await select('5m')
    expect(textValues()).toContain('After 1 minute')
    expect(deps.alert).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'terminal.getAutoRestoreFit')
  })

  it('restores the confirmed value and reports a thrown mutation when reread fails', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(60_000))
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockRejectedValueOnce(new Error('Still offline'))
    await render(sendRequest)
    await select('5m')
    expect(textValues()).toContain('After 1 minute')
    expect(deps.alert).toHaveBeenCalledTimes(1)
  })

  it('ignores a delayed initial read after the user selects a new value', async () => {
    const oldRead = deferred()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(response(300_000))
    await render(sendRequest)
    await select('5m')
    await act(async () => {
      oldRead.resolve(response(60_000))
      await oldRead.promise
    })
    expect(textValues()).toContain('After 5 minutes')
  })

  it('does not let an older selection receipt overwrite a newer selection', async () => {
    const first = deferred()
    const second = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(null))
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await render(sendRequest)
    await select('60s')
    await select('5m')
    await act(async () => {
      second.resolve(response(300_000))
      await second.promise
    })
    await act(async () => {
      first.resolve(response(60_000))
      await first.promise
    })
    expect(textValues()).toContain('After 5 minutes')
    expect(deps.alert).not.toHaveBeenCalled()
  })

  it('does not display a prior client confirmation while the replacement read is pending or failed', async () => {
    await render(vi.fn().mockResolvedValue(response(60_000)))
    expect(textValues()).toContain('After 1 minute')

    const replacementRead = deferred()
    const sendRequest = vi.fn().mockReturnValue(replacementRead.promise)
    await replaceClient(sendRequest)
    expect(sendRequest).toHaveBeenCalledWith('terminal.getAutoRestoreFit')
    expect(textValues()).toContain('…')
    expect(textValues()).not.toContain('After 1 minute')

    await act(async () => {
      replacementRead.reject(new Error('Offline'))
      await replacementRead.promise.catch(() => {})
    })
    expect(textValues()).toContain('…')
  })

  it('does not roll back a failed replacement-client write to the prior client confirmation', async () => {
    await render(vi.fn().mockResolvedValue(response(60_000)))
    const replacementRead = deferred()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(replacementRead.promise)
      .mockRejectedValueOnce(new Error('Set failed'))
      .mockRejectedValueOnce(new Error('Read failed'))
    await replaceClient(sendRequest)
    await select('5m')
    expect(textValues()).toContain('…')
    expect(textValues()).not.toContain('After 1 minute')
    expect(deps.alert).toHaveBeenCalledTimes(1)
    await act(async () => {
      replacementRead.reject(new Error('Initial read failed'))
      await replacementRead.promise.catch(() => {})
    })
    expect(textValues()).toContain('…')
  })

  it('keeps the latest write when only the client map is rebuilt', async () => {
    const write = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(60_000))
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(response(60_000))
    await render(sendRequest)
    await select('5m')
    await rebuildClientsMap()
    expect(textValues()).toContain('After 5 minutes')
    await act(async () => {
      write.resolve(response(300_000))
      await write.promise
    })
    expect(textValues()).toContain('After 5 minutes')
  })

  it('refreshes server truth when the same client map is rebuilt without a pending write', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(60_000))
      .mockResolvedValueOnce(response(300_000))
    await render(sendRequest)
    expect(textValues()).toContain('After 1 minute')
    await rebuildClientsMap()
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(textValues()).toContain('After 5 minutes')
  })
})
