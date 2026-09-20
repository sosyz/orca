import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountsScreen from '../../app/h/[hostId]/accounts'

type Listener = (payload: unknown) => void

const deps = vi.hoisted(() => ({
  client: null as ReturnType<typeof makeClient> | null
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0 })
}))
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ hostId: 'desk' }),
  useRouter: () => ({ back: vi.fn() })
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  User: 'User'
}))
vi.mock('../components/AgentIcons', () => ({ ClaudeIcon: 'ClaudeIcon', OpenAIIcon: 'OpenAIIcon' }))
vi.mock('../components/use-codex-reset-credit-action', () => ({
  useCodexResetCreditAction: () => ({ supported: false, resetting: false, resetScope: null })
}))
vi.mock('../components/CodexResetCreditAction', () => ({ CodexResetCreditAction: 'ResetAction' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 1_000 }))
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [{ id: 'desk', name: 'Desk' }]
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: deps.client, state: 'connected' })
}))

function snapshot(email: string) {
  return {
    claude: {
      accounts: [{ id: 'claude-host', email }],
      activeAccountId: 'claude-host',
      activeAccountIdsByRuntime: { host: 'claude-host', wsl: {} }
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeClient() {
  const listeners = new Set<Listener>()
  return {
    sendRequest: vi.fn(),
    subscribe: vi.fn((_method: string, _params: unknown, listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(payload: unknown) {
      for (const listener of listeners) {
        listener(payload)
      }
    }
  }
}

let renderer: ReactTestRenderer | null = null

async function render(): Promise<void> {
  await act(async () => {
    renderer = create(createElement(AccountsScreen))
    await Promise.resolve()
  })
}

function text(): string[] {
  return renderer!.root.findAllByType('Text').map((node) => node.children.join(''))
}

beforeEach(() => {
  deps.client = makeClient()
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  deps.client = null
})

describe('Accounts subscription fallback', () => {
  it('loads once when an old host rejects accounts.subscribe', async () => {
    const client = deps.client!
    client.sendRequest.mockResolvedValue({ ok: true, result: snapshot('from-list@example.com') })
    await render()
    expect(text()).toContain('Loading accounts…')

    await act(async () => {
      client.emit({ type: 'error', message: 'No stream', error: { code: 'method_not_found' } })
      await Promise.resolve()
    })

    expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('accounts.list')
    expect(text()).toContain('from-list@example.com')
    expect(text()).not.toContain('Loading accounts…')
  })

  it('shows a one-shot failure and does not retry repeated stream errors', async () => {
    const client = deps.client!
    client.sendRequest.mockResolvedValue({ ok: false, error: { message: 'List unavailable' } })
    await render()

    await act(async () => {
      client.emit({ type: 'error', message: 'No stream' })
      client.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })

    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(text()).toContain('List unavailable')
    expect(text()).not.toContain('Loading accounts…')
  })

  it('rejects malformed fallback snapshots without showing stale account data', async () => {
    const client = deps.client!
    client.sendRequest.mockResolvedValue({ ok: true, result: { invalid: true } })
    await render()
    await act(async () => {
      client.emit({ type: 'ready', snapshot: snapshot('previous@example.com') })
    })

    await act(async () => {
      client.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })

    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Invalid accounts snapshot from host')
    expect(text()).not.toContain('previous@example.com')
    expect(text()).not.toContain('Loading accounts…')
  })

  it('does not request accounts.list when the stream succeeds', async () => {
    const client = deps.client!
    await render()

    await act(async () => {
      client.emit({ type: 'ready', snapshot: snapshot('stream@example.com') })
    })

    expect(client.sendRequest).not.toHaveBeenCalled()
    expect(text()).toContain('stream@example.com')
  })

  it('does not let a pending fallback replace a newer stream snapshot', async () => {
    const client = deps.client!
    const list = deferred<{ ok: true; result: ReturnType<typeof snapshot> }>()
    client.sendRequest.mockReturnValue(list.promise)
    await render()
    await act(async () => {
      client.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })
    await act(async () => {
      client.emit({ type: 'ready', snapshot: snapshot('stream@example.com') })
    })
    await act(async () => {
      list.resolve({ ok: true, result: snapshot('old-list@example.com') })
      await list.promise
    })

    expect(text()).toContain('stream@example.com')
    expect(text()).not.toContain('old-list@example.com')
  })

  it('does not let a pending fallback replace a manual refresh result', async () => {
    const client = deps.client!
    const oldList = deferred<{ ok: true; result: ReturnType<typeof snapshot> }>()
    client.sendRequest
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce({ ok: true, result: snapshot('manual@example.com') })
    await render()
    await act(async () => {
      client.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })
    await act(async () => {
      await renderer!.root.findByType('ScrollView').props.refreshControl.props.onRefresh()
    })
    await act(async () => {
      oldList.resolve({ ok: true, result: snapshot('old-list@example.com') })
      await oldList.promise
    })

    expect(client.sendRequest).toHaveBeenCalledTimes(2)
    expect(text()).toContain('manual@example.com')
    expect(text()).not.toContain('old-list@example.com')
  })

  it('does not let a pending manual refresh replace a newer stream snapshot', async () => {
    const client = deps.client!
    const list = deferred<{ ok: true; result: ReturnType<typeof snapshot> }>()
    client.sendRequest.mockReturnValue(list.promise)
    await render()

    await act(async () => {
      client.emit({ type: 'ready', snapshot: snapshot('before@example.com') })
    })
    await act(async () => {
      void renderer!.root.findByType('ScrollView').props.refreshControl.props.onRefresh()
    })
    await act(async () => {
      client.emit({ type: 'snapshot', snapshot: snapshot('new-stream@example.com') })
    })
    await act(async () => {
      list.resolve({ ok: true, result: snapshot('old-list@example.com') })
      await list.promise
    })

    expect(text()).toContain('new-stream@example.com')
    expect(text()).not.toContain('old-list@example.com')
    expect(renderer!.root.findByType('ScrollView').props.refreshControl.props.refreshing).toBe(
      false
    )
  })

  it('does not let a pending manual failure replace a newer stream validation error', async () => {
    const client = deps.client!
    const list = deferred<{ ok: false; error: { message: string } }>()
    client.sendRequest.mockReturnValue(list.promise)
    await render()

    await act(async () => {
      void renderer!.root.findByType('ScrollView').props.refreshControl.props.onRefresh()
    })
    await act(async () => {
      client.emit({ type: 'ready', snapshot: { invalid: true } })
    })
    await act(async () => {
      list.resolve({ ok: false, error: { message: 'Old list failed' } })
      await list.promise
    })

    expect(text()).toContain('Invalid accounts snapshot from host')
    expect(text()).not.toContain('Old list failed')
  })

  it('invalidates an older fallback as soon as manual refresh starts, even if refresh fails', async () => {
    const client = deps.client!
    const fallback = deferred<{ ok: true; result: ReturnType<typeof snapshot> }>()
    const manual = deferred<{ ok: false; error: { message: string } }>()
    client.sendRequest.mockReturnValueOnce(fallback.promise).mockReturnValueOnce(manual.promise)
    await render()

    await act(async () => {
      client.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })
    await act(async () => {
      void renderer!.root.findByType('ScrollView').props.refreshControl.props.onRefresh()
    })
    await act(async () => {
      manual.resolve({ ok: false, error: { message: 'Manual list failed' } })
      await manual.promise
    })
    await act(async () => {
      fallback.resolve({ ok: true, result: snapshot('stale-fallback@example.com') })
      await fallback.promise
    })

    expect(text()).toContain('Manual list failed')
    expect(text()).not.toContain('stale-fallback@example.com')
  })

  it('ignores an old client fallback after the route commits a new client', async () => {
    const oldClient = deps.client!
    const list = deferred<{ ok: true; result: ReturnType<typeof snapshot> }>()
    oldClient.sendRequest.mockReturnValue(list.promise)
    await render()
    await act(async () => {
      oldClient.emit({ type: 'error', message: 'No stream' })
      await Promise.resolve()
    })
    const newClient = makeClient()
    deps.client = newClient
    await act(async () => {
      renderer!.update(createElement(AccountsScreen))
    })
    await act(async () => {
      newClient.emit({ type: 'ready', snapshot: snapshot('new-client@example.com') })
    })
    await act(async () => {
      list.resolve({ ok: true, result: snapshot('old-client@example.com') })
      await list.promise
    })

    expect(text()).toContain('new-client@example.com')
    expect(text()).not.toContain('old-client@example.com')
  })
})
