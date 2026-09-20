import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import { useMobileGitRequests } from './use-mobile-git-requests'
import { useMobileSourceControlRunners } from './use-mobile-source-control-runners'

const haptics = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: haptics.success,
  triggerError: haptics.error
}))
vi.mock('./use-mobile-commit-message-generation', () => ({
  useMobileCommitMessageGeneration: () => ({
    generateCommitMessage: vi.fn(),
    cancelGenerateCommitMessage: vi.fn()
  })
}))
vi.mock('./use-mobile-create-pr-runner', () => ({ useMobileCreatePrRunner: () => vi.fn() }))

const ok = (result: unknown = {}): RpcResponse => ({
  id: 'request',
  ok: true,
  result,
  _meta: { runtimeId: 'host' }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('Source Control workflow client ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let current!: ReturnType<typeof useMobileSourceControlRunners>
  const busyActionRef = { current: null as string | null }
  const mountedRef = { current: true }
  const effects = {
    loadStatus: vi.fn(async () => true),
    setActionError: vi.fn(),
    setBusyAction: vi.fn(),
    setCommitMessage: vi.fn(),
    setShowActionSheet: vi.fn(),
    recordCommitFailure: vi.fn()
  }
  function Harness({
    client,
    connState = 'connected'
  }: {
    client: RpcClient
    connState?: ConnectionState
  }) {
    const requests = useMobileGitRequests({ client, connState, worktreeId: 'wt' })
    current = useMobileSourceControlRunners({
      client,
      connState,
      hostId: 'host',
      worktreeId: 'wt',
      status: null,
      branchLabel: 'branch',
      commitMessage: 'Commit message',
      stagedEntries: [],
      generatingMessage: false,
      stageablePaths: [],
      unstageablePaths: [],
      router: { push: vi.fn() } as never,
      ...requests,
      ...effects,
      mountedRef,
      busyActionRef,
      setGeneratingMessage: vi.fn(),
      setLocalBranches: vi.fn(),
      setShowBranchPicker: vi.fn(),
      setCreatedPrUrl: vi.fn(),
      setCreatedPrWarning: vi.fn()
    })
    return null
  }
  async function render(client: RpcClient, connState: ConnectionState = 'connected') {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { client, connState }))
      } else {
        renderer = create(createElement(Harness, { client, connState }))
      }
    })
  }

  beforeEach(() => {
    busyActionRef.current = null
    mountedRef.current = true
    vi.clearAllMocks()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not start push or apply an old commit receipt after replacing the client', async () => {
    const commit = deferred<RpcResponse>()
    const oldSend = vi.fn((method: string) =>
      method === 'git.commit' ? commit.promise : Promise.resolve(ok())
    )
    const nextSend = vi.fn(async () => ok())
    const oldClient = { sendRequest: oldSend } as unknown as RpcClient
    const nextClient = { sendRequest: nextSend } as unknown as RpcClient
    await render(oldClient)
    let action!: Promise<void>
    await act(async () => {
      action = current.runActionSheetCommitSequence('commit-push', [{ method: 'git.push' }])
    })
    await render(nextClient)
    await act(async () => {
      commit.resolve(ok({ success: true }))
      await action
    })

    expect(oldSend.mock.calls.map(([method]) => method)).toEqual(['git.commit'])
    expect(nextSend).not.toHaveBeenCalled()
    expect(effects.setCommitMessage).not.toHaveBeenCalledWith('')
    expect(effects.setShowActionSheet).not.toHaveBeenCalledWith(false)
    expect(effects.loadStatus).not.toHaveBeenCalled()
    expect(haptics.success).not.toHaveBeenCalled()
  })

  it('holds the same worktree commit claim across client replacement until the first request settles', async () => {
    const oldCommit = deferred<RpcResponse>()
    const oldSend = vi.fn(() => oldCommit.promise)
    const nextSend = vi.fn(async () => ok({ success: true }))
    const oldClient = { sendRequest: oldSend } as unknown as RpcClient
    const nextClient = { sendRequest: nextSend } as unknown as RpcClient
    await render(oldClient)
    let oldAction!: Promise<boolean>
    await act(async () => {
      oldAction = current.commit()
    })
    await render(nextClient)
    await act(async () => {
      expect(await current.commit()).toBe(false)
    })
    expect(nextSend).not.toHaveBeenCalled()

    await act(async () => {
      oldCommit.resolve(ok({ success: true }))
      expect(await oldAction).toBe(false)
    })
    await act(async () => {
      expect(await current.commit()).toBe(true)
    })
    expect(nextSend).toHaveBeenCalledOnce()
  })

  it('does not record an old commit failure after replacing the client', async () => {
    const commit = deferred<RpcResponse>()
    const oldClient = { sendRequest: vi.fn(() => commit.promise) } as unknown as RpcClient
    const nextClient = { sendRequest: vi.fn(async () => ok()) } as unknown as RpcClient
    await render(oldClient)
    let action!: Promise<boolean>
    await act(async () => {
      action = current.commit()
    })
    await render(nextClient)
    await act(async () => {
      commit.reject(new Error('Old commit failed'))
      expect(await action).toBe(false)
    })
    expect(effects.recordCommitFailure).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Old commit failed' })
    )
    expect(effects.setActionError).not.toHaveBeenCalledWith('Old commit failed')
  })

  it('does not publish an old follow-up error after its status refresh and client replacement', async () => {
    const status = deferred<boolean>()
    effects.loadStatus.mockImplementationOnce(() => status.promise)
    const oldClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.commit'
          ? Promise.resolve(ok({ success: true }))
          : Promise.reject(new Error('Old push failed'))
      )
    } as unknown as RpcClient
    const nextClient = { sendRequest: vi.fn(async () => ok()) } as unknown as RpcClient
    await render(oldClient)
    let action!: Promise<void>
    await act(async () => {
      action = current.runActionSheetCommitSequence('commit-push', [{ method: 'git.push' }])
    })
    expect(effects.loadStatus).toHaveBeenCalledOnce()
    await render(nextClient)
    await act(async () => {
      status.resolve(false)
      await action
    })
    expect(effects.setActionError).not.toHaveBeenCalledWith('Old push failed')
  })

  it('does not report an old Git action failure into the replacement client', async () => {
    const discard = deferred<RpcResponse>()
    const oldSend = vi.fn(() => discard.promise)
    const oldClient = { sendRequest: oldSend } as unknown as RpcClient
    const nextClient = { sendRequest: vi.fn(async () => ok()) } as unknown as RpcClient
    await render(oldClient)
    let action!: Promise<boolean>
    await act(async () => {
      action = current.runGitAction('discard:file', 'git.discard', { filePath: 'file' })
    })
    await render(nextClient)
    await act(async () => {
      discard.reject(new Error('Old client failed'))
      await action
    })

    expect(effects.setActionError).not.toHaveBeenCalledWith('Old client failed')
    expect(effects.loadStatus).not.toHaveBeenCalled()
    expect(haptics.error).not.toHaveBeenCalled()
  })

  it.each([
    { blocked: 'git.fetch', state: 'connected' as ConnectionState },
    { blocked: 'git.pull', state: 'connected' as ConnectionState },
    { blocked: 'git.upstreamStatus', state: 'connected' as ConnectionState },
    { blocked: 'git.fetch', state: 'disconnected' as ConnectionState }
  ])('stops sync after $blocked when the source becomes $state', async ({ blocked, state }) => {
    const inFlight = deferred<RpcResponse>()
    const oldSend = vi.fn((method: string) =>
      method === blocked
        ? inFlight.promise
        : Promise.resolve(ok(method === 'git.upstreamStatus' ? { ahead: 1 } : {}))
    )
    const oldClient = { sendRequest: oldSend } as unknown as RpcClient
    const nextClient = { sendRequest: vi.fn(async () => ok()) } as unknown as RpcClient
    await render(oldClient)
    let action!: Promise<void>
    await act(async () => {
      action = current.runActionSheetGitSync()
    })
    expect(oldSend).toHaveBeenCalledWith(blocked, { worktree: 'id:wt' })
    await render(state === 'connected' ? nextClient : oldClient, state)
    await act(async () => {
      inFlight.resolve(ok(blocked === 'git.upstreamStatus' ? { ahead: 1 } : {}))
      await action
    })

    expect(oldSend.mock.calls.at(-1)?.[0]).toBe(blocked)
    expect(nextClient.sendRequest).not.toHaveBeenCalled()
    expect(effects.setShowActionSheet).not.toHaveBeenCalledWith(false)
    expect(effects.loadStatus).not.toHaveBeenCalled()
  })
})
