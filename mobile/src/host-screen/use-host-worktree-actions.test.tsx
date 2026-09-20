import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { setCachedWorktrees } from '../cache/worktree-cache'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { Worktree } from '../worktree/workspace-list-sections'
import { getWorktreeRowIdentity } from '../worktree/worktree-host-row-identity'
import { useHostWorktreeActions, type HostWorktreeActions } from './use-host-worktree-actions'
import { useHostScreenIdentity } from './use-host-screen-identity'
import { useHostScreenState, type HostScreenState } from './use-host-screen-state'

const alerts = vi.hoisted(() => ({ alert: vi.fn() }))
const hostRemoval = vi.hoisted(() => vi.fn())
vi.mock('react-native', () => ({ Alert: alerts }))
vi.mock('../storage/preferences', () => ({
  loadPinnedIds: vi.fn(async () => new Set()),
  savePinnedIds: vi.fn()
}))
vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn(async () => [
    { id: 'host-a', name: 'A' },
    { id: 'host-b', name: 'B' }
  ]),
  updateLastConnected: vi.fn(async () => {})
}))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: hostRemoval }))

const item = {
  worktreeId: 'worktree-a',
  hostId: 'local',
  displayName: 'Workspace A',
  repo: 'repo-a',
  branch: 'main'
} as Worktree
const itemB = { ...item, worktreeId: 'worktree-b', displayName: 'Workspace B' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function harness(response: Promise<RpcResponse>) {
  let rows = [item]
  let lastKnownRows = [item]
  let sleptIds = new Set<string>()
  const setWorktrees: HostScreenState['setWorktrees'] = (update) => {
    rows = typeof update === 'function' ? update(rows) : update
  }
  const setLastKnownWorktrees: HostScreenState['setLastKnownWorktrees'] = (update) => {
    lastKnownRows = typeof update === 'function' ? update(lastKnownRows) : update
  }
  const setSleptIds: HostScreenState['setSleptIds'] = (update) => {
    sleptIds = typeof update === 'function' ? update(sleptIds) : update
  }
  const state = {
    worktrees: rows,
    pinnedIds: new Set<string>(),
    newWorktreeModalRef: { current: null },
    newWorktreeModalVisibleRef: { current: false },
    setConfirmRemoveHost: vi.fn(),
    setLastKnownWorktrees,
    setOptimisticActiveWorktreeIdentity: vi.fn(),
    setPinnedIds: vi.fn(),
    setRouteActionState: vi.fn(),
    setSleptIds,
    setWorktrees
  } as unknown as HostScreenState
  const sendRequest = vi.fn(() => response)
  const client = { sendRequest } as unknown as RpcClient
  const fetchWorktrees = vi.fn(async () => {})
  let actions!: HostWorktreeActions
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(
      createElement(() => {
        actions = useHostWorktreeActions({
          client,
          connState: 'connected',
          embedded: false,
          fetchWorktrees,
          forgetHostClient: vi.fn() as never,
          hostId: 'host-a',
          pathname: '/h/host-a',
          router: { push: vi.fn(), replace: vi.fn() } as never,
          state
        })
        return null
      })
    )
  })
  return {
    actions,
    client,
    fetchWorktrees,
    sendRequest,
    setWorktrees,
    setLastKnownWorktrees,
    unmount: () => act(() => renderer.unmount()),
    get rows() {
      return rows
    },
    get lastKnownRows() {
      return lastKnownRows
    },
    get sleptIds() {
      return sleptIds
    }
  }
}

function mountedHostScreen(clientA: RpcClient, clientB: RpcClient) {
  setCachedWorktrees('host-a', [item], { proven: true })
  setCachedWorktrees('host-b', [itemB], { proven: true })
  let hostId = 'host-a'
  let client: RpcClient | null = clientA
  let state!: HostScreenState
  let actions!: HostWorktreeActions
  const fetchWorktrees = vi.fn(async () => {})
  const router = { push: vi.fn(), replace: vi.fn(), dismissTo: vi.fn() }
  let renderer!: ReturnType<typeof create>
  const forgetHostClient = vi.fn((removedHostId: string) => {
    if (removedHostId === hostId) {
      client = null
      renderer.update(createElement(Sidebar))
    }
  })
  function Sidebar() {
    state = useHostScreenState(hostId, undefined)
    useHostScreenIdentity({ client, hostId, state })
    actions = useHostWorktreeActions({
      client,
      connState: client ? 'connected' : 'disconnected',
      embedded: true,
      fetchWorktrees,
      forgetHostClient: forgetHostClient as never,
      hostId,
      pathname: `/h/${hostId}`,
      router: router as never,
      state
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Sidebar))
  })
  return {
    get state() {
      return state
    },
    get actions() {
      return actions
    },
    fetchWorktrees,
    forgetHostClient,
    router,
    get client() {
      return client
    },
    changeHost(nextHostId: 'host-a' | 'host-b') {
      act(() => {
        hostId = nextHostId
        client = nextHostId === 'host-a' ? clientA : clientB
        renderer.update(createElement(Sidebar))
      })
    },
    setRows(rows: Worktree[]) {
      act(() => {
        state.setWorktrees(rows)
        state.setLastKnownWorktrees(rows)
      })
    },
    unmount() {
      act(() => renderer.unmount())
    }
  }
}

function stagedHostRemoval() {
  const metadata = deferred<void>()
  const connectionLog = deferred<void>()
  hostRemoval.mockImplementationOnce(
    async (hostId: string, forgetHostClient: (hostId: string) => void) => {
      await metadata.promise
      forgetHostClient(hostId)
      await connectionLog.promise
    }
  )
  return { metadata, connectionLog }
}

describe('host worktree actions', () => {
  it('does not duplicate a row when a pre-delete poll wins before failed-delete rollback', async () => {
    const pending = deferred<RpcResponse>()
    const h = harness(pending.promise)
    let deleting!: Promise<void>
    act(() => {
      deleting = h.actions.handleDeleteWorktree(item)
    })
    expect(h.rows).toEqual([])
    act(() => {
      h.setWorktrees([item])
      h.setLastKnownWorktrees([item])
    })
    pending.resolve({
      id: '1',
      ok: false,
      error: { code: 'failed', message: 'failed' }
    } as RpcResponse)
    await act(async () => {
      await deleting
    })
    expect(h.rows).toEqual([item])
    expect(h.lastKnownRows).toEqual([item])
    expect(alerts.alert).toHaveBeenCalledWith('Could not delete workspace', 'Please try again.')
    expect(h.fetchWorktrees).toHaveBeenCalledWith({ allowDuringModal: true, queueIfInFlight: true })
    h.unmount()
  })

  it('queues a fresh post-delete read even if a catalog poll is still in flight', async () => {
    const h = harness(
      Promise.resolve({ id: '1', ok: true, result: { removed: true } } as RpcResponse)
    )
    await act(async () => {
      await h.actions.handleDeleteWorktree(item)
    })
    expect(h.fetchWorktrees).toHaveBeenCalledWith({ allowDuringModal: true, queueIfInFlight: true })
    h.unmount()
  })

  it.each(['rpc-failure', 'rejected-promise'])(
    'rolls back optimistic sleep and reports a %s command',
    async (failure) => {
      alerts.alert.mockClear()
      const response =
        failure === 'rpc-failure'
          ? Promise.resolve({
              id: '1',
              ok: false,
              error: { code: 'sleep_failed', message: 'failed' }
            } as RpcResponse)
          : Promise.reject(new Error('connection closed'))
      const h = harness(response)
      await act(async () => {
        await h.actions.handleSleepWorktree(item)
      })
      expect(h.sleptIds.has(getWorktreeRowIdentity(item))).toBe(false)
      expect(alerts.alert).toHaveBeenCalledWith(
        'Could not sleep workspace',
        'Check the connection and try again.'
      )
      h.unmount()
    }
  )
})

describe('persistent tablet sidebar host ownership', () => {
  it('ignores an old sidebar action callback invoked after the replacement host commits', async () => {
    const clientA = { sendRequest: vi.fn() } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    const oldActions = screen.actions
    screen.changeHost('host-b')
    await act(async () => {
      await oldActions.handleDeleteWorktree(item)
    })
    expect(clientA.sendRequest).not.toHaveBeenCalled()
    expect(screen.state.worktrees).toEqual([itemB])
    screen.unmount()
  })

  it('does not restore an old host row or alert after the sidebar switches hosts', async () => {
    alerts.alert.mockClear()
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const clientB = { sendRequest: vi.fn() } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, clientB)
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    expect(screen.state.worktrees).toEqual([])
    screen.changeHost('host-b')
    expect(screen.state.worktrees).toEqual([itemB])
    await act(async () => {
      pending.resolve({ id: 'rm', ok: false, error: { code: 'failed', message: 'failed' } })
      await deletion
    })
    expect(screen.state.worktrees).toEqual([itemB])
    expect(screen.state.lastKnownWorktrees).toEqual([itemB])
    expect(screen.fetchWorktrees).not.toHaveBeenCalled()
    expect(alerts.alert).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('does not resurrect an old deletion after A to B to A and a newer catalog', async () => {
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    screen.changeHost('host-b')
    screen.changeHost('host-a')
    screen.setRows([])
    await act(async () => {
      pending.resolve({ id: 'rm', ok: false, error: { code: 'failed', message: 'failed' } })
      await deletion
    })
    expect(screen.state.worktrees).toEqual([])
    expect(screen.state.lastKnownWorktrees).toEqual([])
    expect(screen.fetchWorktrees).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('keeps a newer confirmed same-host absence after a failed delete response', async () => {
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    setCachedWorktrees('host-a', [], { proven: true })
    screen.setRows([])
    await act(async () => {
      pending.resolve({ id: 'rm', ok: false, error: { code: 'failed', message: 'failed' } })
      await deletion
    })
    expect(screen.state.worktrees).toEqual([])
    expect(screen.state.lastKnownWorktrees).toEqual([])
    expect(screen.fetchWorktrees).toHaveBeenCalledOnce()
    screen.unmount()
  })

  it('restores a failed deletion when the only absent cache existed before the request', async () => {
    alerts.alert.mockClear()
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    setCachedWorktrees('host-a', [], { proven: true })
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    await act(async () => {
      pending.resolve({ id: 'rm', ok: false, error: { code: 'failed', message: 'failed' } })
      await deletion
    })
    expect(screen.state.worktrees).toEqual([item])
    expect(alerts.alert).toHaveBeenCalledWith('Could not delete workspace', 'Please try again.')
    screen.unmount()
  })

  it('does not refresh a new host for an old successful deletion', async () => {
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    screen.changeHost('host-b')
    await act(async () => {
      pending.resolve({ id: 'rm', ok: true, result: { removed: true } })
      await deletion
    })
    expect(screen.state.worktrees).toEqual([itemB])
    expect(screen.fetchWorktrees).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('does not update state, alert, or refresh after unmount', async () => {
    alerts.alert.mockClear()
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    let deletion!: Promise<void>
    act(() => {
      deletion = screen.actions.handleDeleteWorktree(item)
    })
    screen.unmount()
    await act(async () => {
      pending.resolve({ id: 'rm', ok: false, error: { code: 'failed', message: 'failed' } })
      await deletion
    })
    expect(screen.fetchWorktrees).not.toHaveBeenCalled()
    expect(alerts.alert).not.toHaveBeenCalled()
  })

  it('does not let an old sleep failure clear a newer host override with the same row identity', async () => {
    alerts.alert.mockClear()
    const pending = deferred<RpcResponse>()
    const clientA = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
    let sleeping!: Promise<void>
    act(() => {
      sleeping = screen.actions.handleSleepWorktree(item)
    })
    setCachedWorktrees('host-b', [{ ...item, displayName: 'Workspace B' }], { proven: true })
    screen.changeHost('host-b')
    expect(screen.state.worktrees).toEqual([{ ...item, displayName: 'Workspace B' }])
    expect(screen.state.sleptIds.size).toBe(0)
    act(() => screen.state.setSleptIds(new Set([getWorktreeRowIdentity(item)])))
    await act(async () => {
      pending.reject(new Error('connection closed'))
      await sleeping
    })
    expect(screen.state.sleptIds.has(getWorktreeRowIdentity(item))).toBe(true)
    expect(alerts.alert).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('does not navigate away from a replacement host when old removal completes', async () => {
    const pending = deferred<void>()
    hostRemoval.mockReturnValueOnce(pending.promise)
    const screen = mountedHostScreen(
      { sendRequest: vi.fn() } as unknown as RpcClient,
      { sendRequest: vi.fn() } as unknown as RpcClient
    )
    let removing!: Promise<void>
    act(() => {
      removing = screen.actions.handleRemoveHost()
    })
    screen.changeHost('host-b')
    await act(async () => {
      pending.resolve()
      await removing
    })
    expect(hostRemoval).toHaveBeenCalledWith('host-a', expect.any(Function))
    expect(screen.router.dismissTo).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('navigates after current-host removal even when forgetting the client precedes log cleanup', async () => {
    const { metadata, connectionLog } = stagedHostRemoval()
    const screen = mountedHostScreen(
      { sendRequest: vi.fn() } as unknown as RpcClient,
      { sendRequest: vi.fn() } as unknown as RpcClient
    )
    let removing!: Promise<void>
    act(() => {
      removing = screen.actions.handleRemoveHost()
    })
    await act(async () => {
      metadata.resolve()
      await Promise.resolve()
    })
    expect(screen.client).toBeNull()
    expect(screen.router.dismissTo).not.toHaveBeenCalled()
    await act(async () => {
      connectionLog.resolve()
      await removing
    })
    expect(screen.router.dismissTo).toHaveBeenCalledWith('/')
    screen.unmount()
  })

  it.each(['B', 'B then A'])(
    'does not navigate after removal outlives host switch to %s',
    async (route) => {
      const { metadata, connectionLog } = stagedHostRemoval()
      const clientA = { sendRequest: vi.fn() } as unknown as RpcClient
      const screen = mountedHostScreen(clientA, { sendRequest: vi.fn() } as unknown as RpcClient)
      let removing!: Promise<void>
      act(() => {
        removing = screen.actions.handleRemoveHost()
      })
      screen.changeHost('host-b')
      if (route === 'B then A') {
        screen.changeHost('host-a')
      }
      await act(async () => {
        metadata.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        connectionLog.resolve()
        await removing
      })
      expect(screen.router.dismissTo).not.toHaveBeenCalled()
      screen.unmount()
    }
  )

  it('does not open replacement host removal confirmation after old removal fails', async () => {
    alerts.alert.mockClear()
    const pending = deferred<void>()
    hostRemoval.mockReturnValueOnce(pending.promise)
    const screen = mountedHostScreen(
      { sendRequest: vi.fn() } as unknown as RpcClient,
      { sendRequest: vi.fn() } as unknown as RpcClient
    )
    let removing!: Promise<void>
    act(() => {
      removing = screen.actions.handleRemoveHost()
    })
    screen.changeHost('host-b')
    await act(async () => {
      pending.reject(new Error('storage unavailable'))
      await removing
    })
    expect(screen.state.confirmRemoveHost).toBe(false)
    expect(alerts.alert).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('still reports a failed removal on the current host', async () => {
    alerts.alert.mockClear()
    hostRemoval.mockRejectedValueOnce(new Error('storage unavailable'))
    const screen = mountedHostScreen(
      { sendRequest: vi.fn() } as unknown as RpcClient,
      { sendRequest: vi.fn() } as unknown as RpcClient
    )
    await act(async () => {
      await screen.actions.handleRemoveHost()
    })
    expect(screen.state.confirmRemoveHost).toBe(true)
    expect(alerts.alert).toHaveBeenCalledWith('Could not remove host', 'Please try again.')
    screen.unmount()
  })

  it('still navigates after a current-host removal succeeds', async () => {
    hostRemoval.mockResolvedValueOnce(undefined)
    const screen = mountedHostScreen(
      { sendRequest: vi.fn() } as unknown as RpcClient,
      { sendRequest: vi.fn() } as unknown as RpcClient
    )
    await act(async () => {
      await screen.actions.handleRemoveHost()
    })
    expect(screen.router.dismissTo).toHaveBeenCalledWith('/')
    screen.unmount()
  })
})
