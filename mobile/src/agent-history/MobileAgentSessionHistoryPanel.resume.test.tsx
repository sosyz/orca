import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import { MobileAgentSessionHistoryPanel } from './MobileAgentSessionHistoryPanel'

const mocks = vi.hoisted(() => ({
  onResume: null as ((session: AiVaultSession) => Promise<void>) | null,
  client: null as { sendRequest: ReturnType<typeof vi.fn> } | null,
  connectionState: 'connected',
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  prepare: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'harmony' },
  StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', RefreshCw: 'RefreshCw' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: mocks.push }) }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: mocks.client, state: mocks.connectionState })
}))
vi.mock('../platform/haptics', () => ({ triggerSuccess: mocks.success, triggerError: mocks.error }))
vi.mock('../hooks/use-now', () => ({ useNow: () => Date.parse('2026-09-19T00:00:00Z') }))
vi.mock('../session/ai-vault-resume-preparation', () => ({
  prepareMobileAiVaultSessionResume: mocks.prepare,
  RESUME_RPC_TIMEOUT_MS: 30_000
}))
vi.mock('./use-mobile-agent-history-state', () => ({
  useMobileAgentHistoryState: () => ({
    scope: 'all',
    screenState: { kind: 'ready', sessions: [session], issues: [] },
    refreshing: false,
    hostStatusResult: { hostPlatform: 'darwin' },
    activeWorktreePath: '/repo/workspace',
    scopeFilterPaths: [],
    onSelectScope: vi.fn(),
    onRefresh: vi.fn(),
    retry: vi.fn()
  })
}))
vi.mock('./MobileAgentSessionHistoryList', () => ({
  MobileAgentSessionHistoryList: (props: { onResume: typeof mocks.onResume }) => {
    mocks.onResume = props.onResume
    return null
  }
}))

const session: AiVaultSession = {
  id: 'claude:one',
  agent: 'claude',
  sessionId: 'session-one',
  executionHostId: 'local',
  title: 'Work',
  cwd: '/repo/workspace',
  branch: 'main',
  model: null,
  filePath: '/history/one.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-09-19T00:00:00Z',
  messageCount: 1,
  totalTokens: 0,
  previewMessages: [{ role: 'user', text: 'Work', timestamp: null }],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: '',
  subagent: null
}
const worktree = { worktreeId: 'wt-one', repoId: 'repo', path: '/repo/workspace', hostId: 'local' }
const success = (result: unknown) => ({ id: 'rpc', ok: true, result })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('agent history resume lifetime', () => {
  let renderer: ReactTestRenderer | null = null
  let sendRequest: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connectionState = 'connected'
    mocks.prepare.mockImplementation(async (_client, value) => value)
    sendRequest = vi.fn(async (method: string) => {
      if (method === 'worktree.ps') {
        return success({ worktrees: [worktree] })
      }
      if (method === 'repo.list') {
        return success({ repos: [{ id: 'repo', executionHostId: 'local' }] })
      }
      if (method === 'session.tabs.createTerminal') {
        return success({ tab: { id: 'tab', type: 'terminal', terminal: 'terminal' } })
      }
      if (method === 'terminal.send') {
        return success({ send: { accepted: true } })
      }
      return success({})
    })
    mocks.client = { sendRequest }
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount() {
    await act(async () => {
      renderer = create(
        createElement(MobileAgentSessionHistoryPanel, {
          hostId: 'host-one',
          worktreeId: 'wt-one'
        })
      )
    })
  }

  async function update(hostId = 'host-one', worktreeId = 'wt-one') {
    await act(async () =>
      renderer!.update(createElement(MobileAgentSessionHistoryPanel, { hostId, worktreeId }))
    )
  }

  it('resumes once on duplicate taps and navigates after accepted delivery', async () => {
    await mount()
    await act(async () => {
      await Promise.all([mocks.onResume!(session), mocks.onResume!(session)])
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.createTerminal')
    ).toHaveLength(1)
    expect(sendRequest.mock.calls.filter(([method]) => method === 'terminal.send')).toHaveLength(1)
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/h/host-one/session/wt-one')
  })

  it.each(['client', 'worktree', 'disconnect'])(
    'invalidates preparation when %s changes',
    async (change) => {
      const preparation = deferred<AiVaultSession>()
      mocks.prepare.mockReturnValue(preparation.promise)
      await mount()
      const oldResume = mocks.onResume!
      let pending!: Promise<void>
      await act(async () => {
        pending = oldResume(session)
      })
      if (change === 'client') {
        mocks.client = { sendRequest: vi.fn() }
      }
      if (change === 'disconnect') {
        mocks.connectionState = 'reconnecting'
      }
      await update('host-one', change === 'worktree' ? 'wt-two' : 'wt-one')
      await act(async () => {
        preparation.resolve(session)
        await pending
      })
      expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain(
        'session.tabs.createTerminal'
      )
      expect(mocks.push).not.toHaveBeenCalled()
    }
  )

  it('does not navigate or reuse a successful mutation after an A-B-A scope switch', async () => {
    const sending = deferred<unknown>()
    const original = sendRequest.getMockImplementation()!
    sendRequest.mockImplementation((method: string) =>
      method === 'terminal.send' ? sending.promise : original(method)
    )
    await mount()
    let pending!: Promise<void>
    await act(async () => {
      pending = mocks.onResume!(session)
    })
    const createdBefore = sendRequest.mock.calls.find(
      ([method]) => method === 'session.tabs.createTerminal'
    )!
    await update('host-one', 'wt-two')
    await update()
    await act(async () => {
      await mocks.onResume!(session)
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.createTerminal')
    ).toHaveLength(1)
    await act(async () => {
      sending.resolve(success({ send: { accepted: true } }))
      await pending
    })
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    await act(async () => {
      await mocks.onResume!(session)
    })
    const createdAfter = sendRequest.mock.calls.filter(
      ([method]) => method === 'session.tabs.createTerminal'
    )[1]!
    expect(createdAfter[1].clientMutationId).not.toEqual(createdBefore[1].clientMutationId)
    expect(mocks.push).toHaveBeenCalledTimes(1)
  })

  it('does not prepare or create a terminal after leaving during metadata loading', async () => {
    const metadata = deferred<unknown>()
    const original = sendRequest.getMockImplementation()!
    sendRequest.mockImplementation((method: string) =>
      method === 'repo.list' ? metadata.promise : original(method)
    )
    await mount()
    let pending!: Promise<void>
    act(() => {
      pending = mocks.onResume!(session)
    })
    act(() => renderer!.unmount())
    await act(async () => {
      metadata.resolve(success({ repos: [{ id: 'repo', executionHostId: 'local' }] }))
      await pending
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain(
      'session.tabs.createTerminal'
    )
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not create a terminal after leaving during session preparation', async () => {
    const preparation = deferred<AiVaultSession>()
    mocks.prepare.mockReturnValue(preparation.promise)
    await mount()
    let pending!: Promise<void>
    await act(async () => {
      pending = mocks.onResume!(session)
    })
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    act(() => renderer!.unmount())
    await act(async () => {
      preparation.resolve(session)
      await pending
    })
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain(
      'session.tabs.createTerminal'
    )
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not send a command or navigate after leaving during terminal creation', async () => {
    const creation = deferred<unknown>()
    const original = sendRequest.getMockImplementation()!
    sendRequest.mockImplementation((method: string) =>
      method === 'session.tabs.createTerminal' ? creation.promise : original(method)
    )
    await mount()
    let pending!: Promise<void>
    await act(async () => {
      pending = mocks.onResume!(session)
    })
    expect(sendRequest.mock.calls.map(([method]) => method)).toContain(
      'session.tabs.createTerminal'
    )
    act(() => renderer!.unmount())
    await act(async () => {
      creation.resolve(success({ tab: { id: 'tab', type: 'terminal', terminal: 'terminal' } }))
      await pending
    })
    expect(sendRequest.mock.calls.filter(([method]) => method === 'terminal.send')).toHaveLength(0)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('does not surface a late error after leaving', async () => {
    const metadata = deferred<unknown>()
    const original = sendRequest.getMockImplementation()!
    sendRequest.mockImplementation((method: string) =>
      method === 'repo.list' ? metadata.promise : original(method)
    )
    await mount()
    let pending!: Promise<void>
    act(() => {
      pending = mocks.onResume!(session)
    })
    act(() => renderer!.unmount())
    await act(async () => {
      metadata.reject(new Error('old host offline'))
      await pending
    })
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('does not use another host worktree list when fresh resume metadata fails', async () => {
    await mount()
    const original = sendRequest.getMockImplementation()!
    const nextClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'worktree.ps'
          ? Promise.reject(new Error('worktrees unavailable'))
          : original(method)
      )
    }
    mocks.client = nextClient
    await update('host-two')

    await act(async () => {
      await mocks.onResume!(session)
    })

    expect(nextClient.sendRequest.mock.calls.map(([method]) => method)).not.toContain(
      'session.tabs.createTerminal'
    )
  })
})
