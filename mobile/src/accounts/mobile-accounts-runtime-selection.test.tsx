import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountsScreen from '../../app/h/[hostId]/accounts'
import { UsageBar } from '../components/AccountUsage'

const deps = vi.hoisted(() => ({
  alert: vi.fn(),
  request: vi.fn(),
  snapshot: {} as object
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: deps.alert },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
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
vi.mock('../hooks/use-now', () => ({ useNow: () => 1000 }))
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [{ id: 'desk', name: 'Desk' }]
}))
vi.mock('../transport/client-context', () => {
  const client = {
    sendRequest: (method: string, params?: unknown) => deps.request(method, params),
    subscribe: (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
      listener({ type: 'ready', snapshot: deps.snapshot })
      return vi.fn()
    }
  }
  return { useHostClient: () => ({ client, state: 'connected' }) }
})

const usage = (usedPercent: number) => ({
  provider: 'claude',
  session: null,
  weekly: null,
  fableWeekly: { usedPercent, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  updatedAt: 1,
  error: null,
  status: 'ok'
})
function snapshot(systemDefault = false) {
  return {
    claude: {
      accounts: [
        { id: 'host-account', email: 'host@example.com', managedAuthRuntime: 'host' },
        {
          id: 'wsl-account',
          email: 'wsl@example.com',
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu'
        }
      ],
      activeAccountId: 'host-account',
      activeAccountIdsByRuntime: {
        host: 'host-account',
        wsl: { Ubuntu: systemDefault ? null : 'wsl-account' }
      }
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: usage(99),
      codex: null,
      claudeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: [
        { accountId: 'host-account', rateLimits: usage(12), updatedAt: 1, isFetching: false }
      ],
      inactiveCodexAccounts: []
    }
  }
}
let renderer: ReactTestRenderer | null = null
async function render() {
  await act(async () => {
    renderer = create(createElement(AccountsScreen))
  })
  return renderer!
}
function row(label: string): ReactTestInstance {
  return renderer!.root
    .findAllByType('Pressable')
    .find((node) => node.findAllByType('Text').some((text) => text.children.join('') === label))!
}
function fablePercent(node: ReactTestInstance) {
  return node.findAllByType(UsageBar).find((bar) => bar.props.label === 'Fable')?.props.usedPercent
}
beforeEach(() => {
  deps.snapshot = snapshot()
  deps.alert.mockReset()
  deps.request.mockReset().mockImplementation(async (method) => ({
    id: method,
    ok: true,
    result: method === 'accounts.list' ? deps.snapshot : null
  }))
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
})
describe('Accounts runtime selection and usage', () => {
  it('marks the Claude WSL account active and keeps each account Fable usage attached', async () => {
    await render()
    expect(row('wsl@example.com').findAllByType('Check')).toHaveLength(1)
    expect(row('host@example.com').findAllByType('Check')).toHaveLength(0)
    expect(fablePercent(row('wsl@example.com'))).toBe(99)
    expect(fablePercent(row('host@example.com'))).toBe(12)
  })
  it('shows Fable-only usage on the active WSL system default', async () => {
    deps.snapshot = snapshot(true)
    await render()
    expect(row('System default').findAllByType('Check')).toHaveLength(1)
    expect(fablePercent(row('System default'))).toBe(99)
  })
  it('clears only the displayed Claude WSL runtime selection', async () => {
    await render()
    await act(async () => row('System default').props.onPress())
    expect(deps.request.mock.calls).toEqual([
      [
        'accounts.selectClaudeForTarget',
        { accountId: null, target: { runtime: 'wsl', wslDistro: 'Ubuntu' } }
      ],
      ['accounts.list', undefined]
    ])
  })
  it('uses legacy host selection when selecting a named host account', async () => {
    await render()
    await act(async () => row('host@example.com').props.onPress())
    expect(deps.request.mock.calls[0]).toEqual([
      'accounts.selectClaude',
      { accountId: 'host-account' }
    ])
  })
  it.each(['method_not_found', 'forbidden'])(
    'explains an old host %s without replaying a host clear',
    async (code) => {
      deps.request.mockResolvedValue({
        id: 'select',
        ok: false,
        error: { code, message: 'Unsupported' }
      })
      await render()
      await act(async () => row('System default').props.onPress())
      expect(deps.request).toHaveBeenCalledExactlyOnceWith('accounts.selectClaudeForTarget', {
        accountId: null,
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
      expect(deps.alert).toHaveBeenCalledWith(
        'Could not switch account',
        expect.stringContaining('Update Orca on the host')
      )
    }
  )
})
