import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { WorktreeCatalogSnapshotClient } from '../worktree/worktree-catalog-snapshot-client'
import { startHostWorktreeRefresh } from '../worktree/host-worktree-refresh'
import { useHostWorktreeCatalog } from './use-host-worktree-catalog'
import type { HostScreenState } from './use-host-screen-state'

vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }))
vi.mock('../cache/worktree-cache', () => ({ setCachedWorktrees: vi.fn() }))
vi.mock('../storage/preferences', () => ({ savePinnedIds: vi.fn() }))
vi.mock('../transport/use-worktree-resync', () => ({
  useWorktreeResync: () => ({ refreshing: false, onRefresh: vi.fn() })
}))
vi.mock('../worktree/host-worktree-refresh', () => ({ startHostWorktreeRefresh: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const catalogResponse = {
  id: '1',
  ok: true,
  result: { snapshotId: 'snapshot-1', worktrees: [] }
} as RpcResponse

describe('host worktree catalog refresh', () => {
  it('reruns a completed mutation refresh after an older poll finishes', async () => {
    const first = deferred<RpcResponse>()
    const second = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const client = { sendRequest } as unknown as RpcClient
    const state = {
      clientRef: { current: client },
      fetchWorktreesInFlightRef: { current: false },
      fetchWorktreesPendingRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      setCatalogError: vi.fn(),
      setLastKnownWorktrees: vi.fn(),
      setOptimisticActiveWorktreeIdentity: vi.fn(),
      setPinnedIds: vi.fn(),
      setSleptIds: vi.fn(),
      setWorktrees: vi.fn(),
      setWorktreesLoaded: vi.fn(),
      worktreeCatalogRef: { current: new WorktreeCatalogSnapshotClient() }
    } as unknown as HostScreenState
    let catalog!: ReturnType<typeof useHostWorktreeCatalog>
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        createElement(() => {
          catalog = useHostWorktreeCatalog({
            client,
            connState: 'connected',
            embedded: false,
            fetchRepoMetadata: vi.fn(),
            hostId: 'host-a',
            state,
            syncViewSettingsFromDesktop: vi.fn(async () => {})
          })
          return null
        })
      )
    })

    const olderPoll = catalog.fetchWorktrees()
    await catalog.fetchWorktrees({ allowDuringModal: true, queueIfInFlight: true })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    first.resolve(catalogResponse)
    await act(async () => {
      await olderPoll
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    second.resolve(catalogResponse)
    await act(async () => {
      await Promise.resolve()
    })
    act(() => renderer.unmount())
  })

  it('does not replay an old-client queued refresh after client replacement', async () => {
    const first = deferred<RpcResponse>()
    const oldSendRequest = vi.fn(() => first.promise)
    const oldClient = { sendRequest: oldSendRequest } as unknown as RpcClient
    const newSendRequest = vi.fn(async () => catalogResponse)
    const newClient = { sendRequest: newSendRequest } as unknown as RpcClient
    const state = {
      clientRef: { current: oldClient },
      fetchWorktreesInFlightRef: { current: false },
      fetchWorktreesPendingRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      setCatalogError: vi.fn(),
      setLastKnownWorktrees: vi.fn(),
      setOptimisticActiveWorktreeIdentity: vi.fn(),
      setPinnedIds: vi.fn(),
      setSleptIds: vi.fn(),
      setWorktrees: vi.fn(),
      setWorktreesLoaded: vi.fn(),
      worktreeCatalogRef: { current: new WorktreeCatalogSnapshotClient() }
    } as unknown as HostScreenState
    let catalog!: ReturnType<typeof useHostWorktreeCatalog>
    let renderer!: ReturnType<typeof create>
    const Probe = ({ client }: { client: RpcClient }) => {
      catalog = useHostWorktreeCatalog({
        client,
        connState: 'connected',
        embedded: false,
        fetchRepoMetadata: vi.fn(),
        hostId: 'host-a',
        state,
        syncViewSettingsFromDesktop: vi.fn(async () => {})
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe, { client: oldClient }))
    })
    const olderPoll = catalog.fetchWorktrees()
    await catalog.fetchWorktrees({ allowDuringModal: true, queueIfInFlight: true })
    act(() => {
      state.clientRef.current = newClient
      renderer.update(createElement(Probe, { client: newClient }))
    })
    await catalog.fetchWorktrees({ queueIfInFlight: true })
    expect(newSendRequest).not.toHaveBeenCalled()
    first.resolve(catalogResponse)
    await act(async () => {
      await olderPoll
    })
    expect(oldSendRequest).toHaveBeenCalledTimes(1)
    expect(newSendRequest).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })

  it('drops a queued refresh when the screen unmounts before the older poll finishes', async () => {
    const first = deferred<RpcResponse>()
    const sendRequest = vi.fn(() => first.promise)
    const client = { sendRequest } as unknown as RpcClient
    const state = {
      clientRef: { current: client },
      fetchWorktreesInFlightRef: { current: false },
      fetchWorktreesPendingRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      setCatalogError: vi.fn(),
      setLastKnownWorktrees: vi.fn(),
      setOptimisticActiveWorktreeIdentity: vi.fn(),
      setPinnedIds: vi.fn(),
      setSleptIds: vi.fn(),
      setWorktrees: vi.fn(),
      setWorktreesLoaded: vi.fn(),
      worktreeCatalogRef: { current: new WorktreeCatalogSnapshotClient() }
    } as unknown as HostScreenState
    let catalog!: ReturnType<typeof useHostWorktreeCatalog>
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        createElement(() => {
          catalog = useHostWorktreeCatalog({
            client,
            connState: 'connected',
            embedded: false,
            fetchRepoMetadata: vi.fn(),
            hostId: 'host-a',
            state,
            syncViewSettingsFromDesktop: vi.fn(async () => {})
          })
          return null
        })
      )
    })
    const olderPoll = catalog.fetchWorktrees()
    await catalog.fetchWorktrees({ allowDuringModal: true, queueIfInFlight: true })
    act(() => renderer.unmount())
    first.resolve(catalogResponse)
    await olderPoll
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('drops a connected refresh queued before disconnection', async () => {
    const first = deferred<RpcResponse>()
    const sendRequest = vi.fn(() => first.promise)
    const client = { sendRequest } as unknown as RpcClient
    const state = {
      clientRef: { current: client },
      fetchWorktreesInFlightRef: { current: false },
      fetchWorktreesPendingRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      setCatalogError: vi.fn(),
      setLastKnownWorktrees: vi.fn(),
      setOptimisticActiveWorktreeIdentity: vi.fn(),
      setPinnedIds: vi.fn(),
      setSleptIds: vi.fn(),
      setWorktrees: vi.fn(),
      setWorktreesLoaded: vi.fn(),
      worktreeCatalogRef: { current: new WorktreeCatalogSnapshotClient() }
    } as unknown as HostScreenState
    let catalog!: ReturnType<typeof useHostWorktreeCatalog>
    const Probe = ({ connected }: { connected: boolean }) => {
      catalog = useHostWorktreeCatalog({
        client,
        connState: connected ? 'connected' : 'disconnected',
        embedded: false,
        fetchRepoMetadata: vi.fn(),
        hostId: 'host-a',
        state,
        syncViewSettingsFromDesktop: vi.fn(async () => {})
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Probe, { connected: true }))
    })
    const olderPoll = catalog.fetchWorktrees()
    await catalog.fetchWorktrees({ queueIfInFlight: true })
    act(() => renderer.update(createElement(Probe, { connected: false })))
    first.resolve(catalogResponse)
    await act(async () => {
      await olderPoll
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })

  it('starts the first embedded refresh after the identity effect publishes its client', () => {
    const sendRequest = vi.fn(async () => catalogResponse)
    const client = { sendRequest } as unknown as RpcClient
    const state = {
      clientRef: { current: null },
      fetchWorktreesInFlightRef: { current: false },
      fetchWorktreesPendingRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      setCatalogError: vi.fn(),
      setLastKnownWorktrees: vi.fn(),
      setOptimisticActiveWorktreeIdentity: vi.fn(),
      setPinnedIds: vi.fn(),
      setSleptIds: vi.fn(),
      setWorktrees: vi.fn(),
      setWorktreesLoaded: vi.fn(),
      worktreeCatalogRef: { current: new WorktreeCatalogSnapshotClient() }
    } as unknown as HostScreenState
    vi.mocked(startHostWorktreeRefresh).mockImplementationOnce(({ fetchWorktrees }) => {
      void fetchWorktrees({ queueIfInFlight: true })
      return () => {}
    })
    const Probe = () => {
      useEffect(() => {
        state.clientRef.current = client
      }, [])
      useHostWorktreeCatalog({
        client,
        connState: 'connected',
        embedded: true,
        fetchRepoMetadata: vi.fn(),
        hostId: 'host-a',
        state,
        syncViewSettingsFromDesktop: vi.fn(async () => {})
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })
})
