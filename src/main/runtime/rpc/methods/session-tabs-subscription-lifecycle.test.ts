import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { RpcDispatcher } from '../dispatcher'
import { createSubscriptionRegistryDouble } from '../subscription-registry-test-double'
import { SESSION_TAB_METHODS } from './session-tabs'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createHarness(phase: 'restore' | 'list' | 'ready') {
  const entered = deferred()
  const release = deferred()
  const registry = createSubscriptionRegistryDouble()
  const registerOwnedSubscriptionCleanup = vi.fn(registry.registerOwnedSubscriptionCleanup)
  const listeners = new Set<() => void>()
  const snapshot = {
    worktree: 'wt-1',
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
  const pause = async () => {
    entered.resolve()
    await release.promise
  }
  const snapshotFor = (worktree: string) => ({
    ...snapshot,
    worktree: worktree === 'id:wt-2' ? 'wt-2' : 'wt-1'
  })
  const list = vi.fn(async (worktree: string) => snapshotFor(worktree))
  if (phase === 'list') {
    list.mockImplementationOnce(async (worktree: string) => {
      await pause()
      return snapshotFor(worktree)
    })
  }
  const runtime = {
    ...registry,
    getRuntimeId: () => 'runtime-1',
    restoreStructuredAgentSessionTabs: vi.fn(phase === 'restore' ? pause : async () => {}),
    listMobileSessionTabs: list,
    registerOwnedSubscriptionCleanup,
    onMobileSessionTabsChanged: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })
  const replies = vi.fn()
  const options = {
    connectionId: 'conn-1',
    clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
  }
  const subscribe = (
    id = 'subscribe-1',
    worktree = 'id:wt-1',
    connectionId = 'conn-1',
    signal?: AbortSignal
  ) =>
    dispatcher.dispatchStreaming(
      { id, authToken: 'token', method: 'session.tabs.subscribe', params: { worktree } },
      replies,
      { ...options, connectionId, signal }
    )
  const unsubscribe = (subscriptionId?: string) =>
    dispatcher.dispatchStreaming(
      {
        id: 'unsubscribe-1',
        authToken: 'token',
        method: 'session.tabs.unsubscribe',
        params: { worktree: 'id:wt-1', subscriptionId }
      },
      vi.fn(),
      options
    )
  return {
    entered,
    release,
    get cleanups() {
      const ids = registerOwnedSubscriptionCleanup.mock.calls.map(([id]) => id)
      return new Map(
        ids.flatMap((id) => {
          const cleanup = registry.peekCleanup(id)
          return cleanup ? [[id, cleanup] as const] : []
        })
      )
    },
    listeners,
    runtime,
    replies,
    subscribe,
    unsubscribe,
    snapshot
  }
}

describe.each(['restore', 'list'] as const)('session tabs cancellation during %s', (phase) => {
  it('does not install a listener after unsubscribe completed during initialization', async () => {
    const harness = createHarness(phase)
    const pending = harness.subscribe()
    await harness.entered.promise

    await harness.unsubscribe()
    harness.release.resolve()
    await pending

    expect(harness.listeners.size).toBe(0)
    expect(harness.cleanups.size).toBe(0)
    expect(harness.runtime.onMobileSessionTabsChanged).not.toHaveBeenCalled()
    expect(harness.replies).not.toHaveBeenCalled()
  })

  it('allows a newer subscription on the same connection after cancellation', async () => {
    const harness = createHarness(phase)
    const previous = harness.subscribe()
    await harness.entered.promise
    await harness.unsubscribe()

    const current = harness.subscribe('subscribe-2')
    harness.release.resolve()
    await Promise.all([previous, current])

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-1:subscribe-2'])
  })

  it('does not mark a newer setup while an older unsubscribe is resolving its worktree', async () => {
    const harness = createHarness(phase)
    const previous = harness.subscribe()
    await harness.entered.promise
    const lookupEntered = deferred()
    const lookupRelease = deferred()
    vi.mocked(harness.runtime.listMobileSessionTabs).mockImplementationOnce(async () => {
      lookupEntered.resolve()
      await lookupRelease.promise
      return harness.snapshot
    })
    const cancellation = harness.unsubscribe()
    await lookupEntered.promise
    vi.mocked(harness.runtime.listMobileSessionTabs).mockImplementationOnce(async () => {
      await harness.release.promise
      return harness.snapshot
    })
    const current = harness.subscribe('subscribe-2')
    await Promise.resolve()
    lookupRelease.resolve()
    await cancellation
    harness.release.resolve()
    await Promise.all([previous, current])

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-1:subscribe-2'])
  })

  it('preserves a sibling subscription when cancellation names one request', async () => {
    const harness = createHarness(phase)
    const previous = harness.subscribe()
    await harness.entered.promise
    const sibling = harness.subscribe('subscribe-2')
    await harness.unsubscribe('subscribe-1')
    harness.release.resolve()
    await Promise.all([previous, sibling])

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-1:subscribe-2'])
  })

  it('does not cancel a pending subscription on another connection', async () => {
    const harness = createHarness(phase)
    const pending = harness.subscribe('subscribe-1', 'id:wt-1', 'conn-2')
    await harness.entered.promise
    await harness.unsubscribe()
    harness.release.resolve()
    await pending

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-2:wt-1:subscribe-1'])
  })

  it('matches an alias by the resolved worktree without cancelling other workspaces', async () => {
    const harness = createHarness(phase)
    const alias = harness.subscribe('subscribe-1', 'name:workspace')
    await harness.entered.promise
    const other = harness.subscribe('subscribe-2', 'id:wt-2')
    await harness.unsubscribe()
    harness.release.resolve()
    await Promise.all([alias, other])

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-2:subscribe-2'])
  })

  it('does not install a listener after the connection signal aborts', async () => {
    const harness = createHarness(phase)
    const connection = new AbortController()
    const pending = harness.subscribe('subscribe-1', 'id:wt-1', 'conn-1', connection.signal)
    await harness.entered.promise
    connection.abort()
    harness.release.resolve()
    await pending

    expect(harness.listeners.size).toBe(0)
    expect(harness.cleanups.size).toBe(0)
    expect(harness.replies).not.toHaveBeenCalled()
  })
})

describe('session tabs cancellation after initialization', () => {
  it.each(['subscribe-1', 'subscribe-2'])(
    'preserves the newer active registration %s while unsubscribe resolves',
    async (nextId) => {
      const harness = createHarness('ready')
      await harness.subscribe()
      const lookupEntered = deferred()
      const lookupRelease = deferred()
      vi.mocked(harness.runtime.listMobileSessionTabs).mockImplementationOnce(async () => {
        lookupEntered.resolve()
        await lookupRelease.promise
        return harness.snapshot
      })

      const cancellation = harness.unsubscribe()
      await lookupEntered.promise
      await harness.subscribe(nextId)
      lookupRelease.resolve()
      await cancellation

      expect(harness.listeners.size).toBe(1)
      expect([...harness.cleanups.keys()]).toEqual([`session.tabs:conn-1:wt-1:${nextId}`])
    }
  )

  it('cleans a captured setup that becomes active without cancelling its newer sibling', async () => {
    const harness = createHarness('list')
    const previous = harness.subscribe()
    await harness.entered.promise
    const lookupEntered = deferred()
    const lookupRelease = deferred()
    vi.mocked(harness.runtime.listMobileSessionTabs).mockImplementationOnce(async () => {
      lookupEntered.resolve()
      await lookupRelease.promise
      return harness.snapshot
    })
    const cancellation = harness.unsubscribe()
    await lookupEntered.promise
    harness.release.resolve()
    await previous
    await harness.subscribe('subscribe-2')

    lookupRelease.resolve()
    await cancellation

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-1:subscribe-2'])
  })

  it('does not apply a targeted stale cancellation to a replacement of the same request id', async () => {
    const harness = createHarness('ready')
    await harness.subscribe()
    const lookupEntered = deferred()
    const lookupRelease = deferred()
    vi.mocked(harness.runtime.listMobileSessionTabs).mockImplementationOnce(async () => {
      lookupEntered.resolve()
      await lookupRelease.promise
      return harness.snapshot
    })
    const cancellation = harness.unsubscribe('subscribe-1')
    await lookupEntered.promise
    await harness.subscribe('subscribe-1')
    lookupRelease.resolve()
    await cancellation

    expect(harness.listeners.size).toBe(1)
    expect([...harness.cleanups.keys()]).toEqual(['session.tabs:conn-1:wt-1:subscribe-1'])
  })
})
