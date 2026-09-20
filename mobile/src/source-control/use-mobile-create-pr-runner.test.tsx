import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { useMobileSourceControlRunners } from './use-mobile-source-control-runners'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

type Params = Parameters<typeof useMobileSourceControlRunners>[0]
type Runners = ReturnType<typeof useMobileSourceControlRunners>
const ok = (result: unknown): RpcResponse => ({
  id: 'test',
  ok: true,
  result,
  _meta: { runtimeId: 'test' }
})
const entry = (area: 'unstaged' | 'staged') => ({ path: 'a.ts', status: 'modified' as const, area })
const status = (entries: ReturnType<typeof entry>[], ahead = 0) => ({
  entries,
  branch: 'feature/a',
  head: 'sha',
  conflictOperation: 'unknown' as const,
  upstreamStatus: { hasUpstream: true, ahead, behind: 0 }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function createHost(provider: 'github' | 'gitlab' = 'github', gateMethod?: string) {
  const gate = deferred<void>()
  const reached = deferred<void>()
  const replies: Array<[string, RpcResponse]> = [
    ['git.status', ok(status([entry('unstaged')]))],
    ['git.bulkStage', ok({ success: true })],
    ['git.status', ok(status([entry('staged')]))],
    ['git.generateCommitMessage', ok({ success: true, message: 'Generated commit' })],
    ['git.commit', ok({ success: true })],
    ['git.status', ok(status([], 1))],
    ...[false, true].flatMap((pushed): Array<[string, RpcResponse]> => [
      ...(pushed
        ? ([
            ['git.push', ok({ success: true })],
            ['git.status', ok(status([]))]
          ] as Array<[string, RpcResponse]>)
        : []),
      [
        'hostedReview.getCreationEligibility',
        ok({
          provider,
          defaultBaseRef: 'main',
          title: 'Feature A',
          body: 'Review body',
          canCreate: pushed,
          blockedReason: pushed ? null : 'needs_push',
          nextAction: pushed ? null : 'push',
          reviewLookupOutcome: 'not_found'
        })
      ]
    ]),
    ['hostedReview.create', ok({ ok: true, number: 17, url: 'https://example.invalid/review/17' })],
    ['worktree.set', ok({ worktree: {} })]
  ]
  let gated = false
  const sendRequest = vi.fn(async (method: string, _params?: unknown) => {
    const response = replies.shift()
    expect(method).toBe(response?.[0])
    if (!gated && method === gateMethod) {
      gated = true
      reached.resolve()
      await gate.promise
    }
    return response![1]
  })
  return {
    client: { sendRequest } as unknown as NonNullable<Params['client']>,
    sendRequest,
    gate,
    reached
  }
}

describe('create PR workflow ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let runners: Runners
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(client: Params['client']) {
    const params: Params = {
      client,
      connState: 'connected',
      hostId: 'host',
      worktreeId: 'repo::/a',
      status: status([entry('unstaged')]),
      branchLabel: 'Feature A',
      commitMessage: '',
      stagedEntries: [entry('staged')],
      generatingMessage: false,
      stageablePaths: [],
      unstageablePaths: [],
      router: { push: vi.fn() } as never,
      sendGitRequest: vi.fn(),
      sendCommitRequest: vi.fn(),
      runGitSyncSteps: vi.fn(),
      loadStatus: vi.fn(async () => true),
      mountedRef: { current: true },
      busyActionRef: { current: null },
      setBusyAction: vi.fn(),
      setActionError: vi.fn(),
      setCommitMessage: vi.fn(),
      setGeneratingMessage: vi.fn(),
      setShowActionSheet: vi.fn(),
      setLocalBranches: vi.fn(),
      setShowBranchPicker: vi.fn(),
      setCreatedPrUrl: vi.fn(),
      setCreatedPrWarning: vi.fn(),
      recordCommitFailure: vi.fn()
    }
    function Probe({ value }: { value: Params }) {
      useLayoutEffect(
        () => () => {
          value.mountedRef.current = false
        },
        []
      )
      runners = useMobileSourceControlRunners(value)
      return null
    }
    act(() => {
      renderer = create(createElement(Probe, { value: params }))
    })
    return {
      params,
      update: (overrides: Partial<Params>) =>
        act(() => {
          Object.assign(params, overrides)
          renderer!.update(createElement(Probe, { value: { ...params } }))
        })
    }
  }

  const protectedUiKeys = [
    'setActionError',
    'setCommitMessage',
    'setCreatedPrUrl',
    'setCreatedPrWarning',
    'recordCommitFailure',
    'loadStatus'
  ] as const
  function clearProtectedUi(params: Params) {
    for (const key of protectedUiKeys) {
      vi.mocked(params[key]).mockClear()
    }
  }
  function expectNoLateUi(params: Params) {
    for (const key of protectedUiKeys) {
      expect(params[key], key).not.toHaveBeenCalled()
    }
  }

  it.each(['github', 'gitlab'] as const)(
    'preserves the complete %s create and link flow',
    async (provider) => {
      const host = createHost(provider)
      const { params } = mount(host.client)
      await act(async () => {
        await runners.createPr(true)
      })
      expect(host.sendRequest).toHaveBeenCalledWith(
        'hostedReview.create',
        expect.objectContaining({
          provider,
          worktree: 'id:repo::/a',
          head: 'feature/a',
          base: 'main',
          title: 'Feature A'
        })
      )
      expect(host.sendRequest).toHaveBeenLastCalledWith('worktree.set', {
        worktree: 'id:repo::/a',
        baseRef: 'main',
        [provider === 'github' ? 'linkedPR' : 'linkedGitLabMR']: 17
      })
      expect(params.setCreatedPrUrl).toHaveBeenCalledWith('https://example.invalid/review/17')
      expect(params.setCommitMessage).toHaveBeenCalledWith('')
      expect(params.loadStatus).toHaveBeenCalledTimes(1)
      expect(params.busyActionRef.current).toBeNull()
    }
  )

  for (const boundary of ['unmount', 'replacement'] as const) {
    it.each([
      'git.bulkStage',
      'git.commit',
      'hostedReview.getCreationEligibility',
      'hostedReview.create'
    ])(`does not continue or update UI after ${boundary} during %s`, async (gateMethod) => {
      const host = createHost('github', gateMethod)
      const { params, update } = mount(host.client)
      let running!: Promise<void>
      await act(async () => {
        running = runners.createPr(false)
        await host.reached.promise
      })
      const countAtBoundary = host.sendRequest.mock.calls.length
      const replacement = createHost()
      if (boundary === 'unmount') {
        act(() => renderer!.unmount())
      } else {
        update({ client: replacement.client })
      }
      clearProtectedUi(params)
      await act(async () => {
        host.gate.resolve()
        await running
      })
      expect(host.sendRequest).toHaveBeenCalledTimes(countAtBoundary)
      expect(replacement.sendRequest).not.toHaveBeenCalled()
      expectNoLateUi(params)
      // An already dispatched create may have succeeded; never claim cancellation undid it.
      if (gateMethod === 'hostedReview.create') {
        expect(
          host.sendRequest.mock.calls.filter(([method]) => method === gateMethod)
        ).toHaveLength(1)
      }
    })
  }

  it('ignores Direct.close commit rejection after replacing the client', async () => {
    const host = createHost('github', 'git.commit')
    const { params, update } = mount(host.client)
    let running!: Promise<void>
    await act(async () => {
      running = runners.createPr(false)
      await host.reached.promise
    })
    update({ client: createHost().client })
    clearProtectedUi(params)
    await act(async () => {
      host.gate.reject(new Error('Client closed'))
      await running
    })
    expectNoLateUi(params)
    expect(params.busyActionRef.current).toBeNull()
  })

  it('retains an actionable commit failure while its owner remains current', async () => {
    const host = createHost('github', 'git.commit')
    const { params } = mount(host.client)
    let running!: Promise<void>
    await act(async () => {
      running = runners.createPr(false)
      await host.reached.promise
    })
    await act(async () => {
      host.gate.reject(new Error('Commit hook failed'))
      await running
    })
    expect(params.recordCommitFailure).toHaveBeenLastCalledWith({
      error: 'Commit hook failed',
      commitMessage: 'Generated commit',
      stagedEntries: [entry('staged')]
    })
    expect(params.setCreatedPrUrl).not.toHaveBeenCalled()
    expect(params.busyActionRef.current).toBeNull()
  })

  it('does not publish a commit failure when its recovery refresh outlives the owner', async () => {
    const host = createHost('github', 'git.commit')
    const { params, update } = mount(host.client)
    const refresh = deferred<boolean>()
    const refreshStarted = deferred<void>()
    vi.mocked(params.loadStatus).mockImplementation(() => {
      refreshStarted.resolve()
      return refresh.promise
    })
    let running!: Promise<void>
    await act(async () => {
      running = runners.createPr(false)
      await host.reached.promise
    })
    await act(async () => {
      host.gate.reject(new Error('Commit hook failed'))
      await refreshStarted.promise
    })
    update({ client: createHost().client })
    clearProtectedUi(params)
    await act(async () => {
      refresh.resolve(true)
      await running
    })
    expectNoLateUi(params)
  })

  it('rejects a retained callback without closing the new action sheet', async () => {
    const host = createHost()
    const { params, update } = mount(host.client)
    const abandoned = runners.createPr
    const replacement = createHost()
    update({ client: replacement.client })
    clearProtectedUi(params)
    vi.mocked(params.setShowActionSheet).mockClear()
    await act(async () => {
      await abandoned(false)
    })
    expect(host.sendRequest).not.toHaveBeenCalled()
    expect(replacement.sendRequest).not.toHaveBeenCalled()
    expect(params.setShowActionSheet).not.toHaveBeenCalled()
    expectNoLateUi(params)
  })

  it('keeps the busy claim until abandoned work settles, then allows the new client to create', async () => {
    const host = createHost('github', 'hostedReview.getCreationEligibility')
    const { params, update } = mount(host.client)
    let running!: Promise<void>
    await act(async () => {
      running = runners.createPr(false)
      await host.reached.promise
    })
    const replacement = createHost('gitlab')
    update({ client: replacement.client })
    await act(async () => {
      await runners.createPr(false)
    })
    expect(replacement.sendRequest).not.toHaveBeenCalled()
    await act(async () => {
      host.gate.resolve()
      await running
    })
    expect(params.busyActionRef.current).toBeNull()
    await act(async () => {
      await runners.createPr(false)
    })
    expect(params.setCreatedPrUrl).toHaveBeenCalledWith('https://example.invalid/review/17')
    expect(replacement.sendRequest).toHaveBeenCalledWith(
      'hostedReview.create',
      expect.objectContaining({ provider: 'gitlab' })
    )
  })

  it('does not revive the first attempt after the same client returns', async () => {
    const host = createHost('github', 'hostedReview.getCreationEligibility')
    const { params, update } = mount(host.client)
    let running!: Promise<void>
    await act(async () => {
      running = runners.createPr(false)
      await host.reached.promise
    })
    const countAtBoundary = host.sendRequest.mock.calls.length
    update({ client: createHost().client })
    update({ client: host.client })
    clearProtectedUi(params)
    await act(async () => {
      host.gate.resolve()
      await running
    })
    expect(host.sendRequest).toHaveBeenCalledTimes(countAtBoundary)
    expectNoLateUi(params)
    expect(params.busyActionRef.current).toBeNull()
  })
})
