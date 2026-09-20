import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_AI_VAULT_CAPABILITY } from './agent-history-capability'
import { useMobileAgentHistoryState } from './use-mobile-agent-history-state'

const mocks = vi.hoisted(() => ({
  client: null as { sendRequest: ReturnType<typeof vi.fn> } | null,
  state: 'connected' as string
}))

vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: mocks.client, state: mocks.state }),
  useForceReconnect: () => vi.fn()
}))

const success = (result: unknown) => ({ id: 'rpc', ok: true, result })
const worktrees: [] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('agent history data source ownership', () => {
  beforeEach(() => {
    mocks.client = null
    mocks.state = 'connected'
  })

  it.each(['host', 'client'])(
    'hides the prior ready list and status while a new %s source is loading',
    async (change) => {
      const pendingStatus = deferred<ReturnType<typeof success>>()
      let holdAStatus = false
      const clientA = {
        sendRequest: vi.fn(async (method: string) => {
          if (method === 'status.get') {
            return holdAStatus
              ? pendingStatus.promise
              : success({ hostPlatform: 'darwin', capabilities: [MOBILE_AI_VAULT_CAPABILITY] })
          }
          return success({ sessions: [{ id: 'session-from-A' }], issues: [] })
        })
      }
      const clientB = {
        sendRequest: vi.fn(async () => pendingStatus.promise)
      }
      mocks.client = clientA
      let snapshot: ReturnType<typeof useMobileAgentHistoryState> | null = null
      let renderer: ReactTestRenderer | null = null
      function Harness({ hostId }: { hostId: string }) {
        snapshot = useMobileAgentHistoryState({
          hostId,
          worktreeId: 'wt-one',
          worktrees,
          worktreesLoaded: true
        })
        return null
      }

      await act(async () => {
        renderer = create(createElement(Harness, { hostId: 'host-A' }))
      })
      expect(snapshot!.screenState.kind).toBe('ready')
      expect(snapshot!.hostStatusResult).toMatchObject({ hostPlatform: 'darwin' })

      if (change === 'host') {
        holdAStatus = true
      } else {
        mocks.client = clientB
      }
      await act(async () => {
        renderer!.update(
          createElement(Harness, { hostId: change === 'host' ? 'host-B' : 'host-A' })
        )
      })

      expect(snapshot!.screenState.kind).toBe('loading')
      expect(snapshot!.hostStatusResult).toBeNull()
      act(() => renderer!.unmount())
    }
  )

  it('keeps a ready list through a temporary disconnect from the same source', async () => {
    mocks.client = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'status.get'
          ? success({ hostPlatform: 'darwin', capabilities: [MOBILE_AI_VAULT_CAPABILITY] })
          : success({ sessions: [{ id: 'session-from-A' }], issues: [] })
      )
    }
    let snapshot: ReturnType<typeof useMobileAgentHistoryState> | null = null
    function Harness() {
      snapshot = useMobileAgentHistoryState({
        hostId: 'host-A',
        worktreeId: 'wt-one',
        worktrees,
        worktreesLoaded: true
      })
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(snapshot!.screenState.kind).toBe('ready')

    mocks.state = 'reconnecting'
    await act(async () => renderer.update(createElement(Harness)))

    expect(snapshot!.screenState.kind).toBe('ready')
    act(() => renderer.unmount())
  })

  it('rejects an old refresh callback during the new source layout commit', async () => {
    const clientA = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'status.get'
          ? success({ capabilities: [MOBILE_AI_VAULT_CAPABILITY] })
          : success({ sessions: [], issues: [] })
      )
    }
    const pendingStatus = deferred<ReturnType<typeof success>>()
    const clientB = { sendRequest: vi.fn(async () => pendingStatus.promise) }
    mocks.client = clientA
    let snapshot: ReturnType<typeof useMobileAgentHistoryState> | null = null
    let oldRefresh: (() => Promise<void>) | null = null
    function Harness({ hostId }: { hostId: string }) {
      snapshot = useMobileAgentHistoryState({
        hostId,
        worktreeId: 'wt-one',
        worktrees,
        worktreesLoaded: true
      })
      useLayoutEffect(() => {
        if (hostId === 'host-B') {
          void oldRefresh?.()
        }
      }, [hostId])
      return null
    }

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-A' }))
    })
    oldRefresh = snapshot!.onRefresh
    const callsBeforeSwitch = clientA.sendRequest.mock.calls.length
    mocks.client = clientB
    await act(async () => {
      renderer.update(createElement(Harness, { hostId: 'host-B' }))
    })

    expect(clientA.sendRequest).toHaveBeenCalledTimes(callsBeforeSwitch)
    expect(snapshot!.screenState.kind).toBe('loading')
    act(() => renderer.unmount())
  })

  it('does not restore an old refresh spinner after disconnect and reconnect', async () => {
    const pendingRefresh = deferred<ReturnType<typeof success>>()
    let listCalls = 0
    mocks.client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'status.get') {
          return success({ capabilities: [MOBILE_AI_VAULT_CAPABILITY] })
        }
        listCalls += 1
        return listCalls === 2
          ? pendingRefresh.promise
          : success({ sessions: [{ id: 'session-from-A' }], issues: [] })
      })
    }
    let snapshot: ReturnType<typeof useMobileAgentHistoryState> | null = null
    function Harness() {
      snapshot = useMobileAgentHistoryState({
        hostId: 'host-A',
        worktreeId: 'wt-one',
        worktrees,
        worktreesLoaded: true
      })
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let refresh!: Promise<void>
    await act(async () => {
      refresh = snapshot!.onRefresh()
    })
    expect(snapshot!.refreshing).toBe(true)

    mocks.state = 'reconnecting'
    await act(async () => renderer.update(createElement(Harness)))
    expect(snapshot!.screenState.kind).toBe('ready')
    expect(snapshot!.refreshing).toBe(false)

    mocks.state = 'connected'
    await act(async () => renderer.update(createElement(Harness)))
    expect(snapshot!.refreshing).toBe(false)
    await act(async () => {
      pendingRefresh.resolve(success({ sessions: [], issues: [] }))
      await refresh
    })
    expect(snapshot!.refreshing).toBe(false)
    act(() => renderer.unmount())
  })

  it('keeps the spinner for the newer of two concurrent refreshes', async () => {
    const firstRefresh = deferred<ReturnType<typeof success>>()
    const secondRefresh = deferred<ReturnType<typeof success>>()
    let listCalls = 0
    mocks.client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'status.get') {
          return success({ capabilities: [MOBILE_AI_VAULT_CAPABILITY] })
        }
        listCalls += 1
        if (listCalls === 2) {
          return firstRefresh.promise
        }
        if (listCalls === 3) {
          return secondRefresh.promise
        }
        return success({ sessions: [], issues: [] })
      })
    }
    let snapshot: ReturnType<typeof useMobileAgentHistoryState> | null = null
    function Harness() {
      snapshot = useMobileAgentHistoryState({
        hostId: 'host-A',
        worktreeId: 'wt-one',
        worktrees,
        worktreesLoaded: true
      })
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let older!: Promise<void>
    let newer!: Promise<void>
    await act(async () => {
      older = snapshot!.onRefresh()
    })
    expect(listCalls).toBe(2)
    await act(async () => {
      newer = snapshot!.onRefresh()
    })
    expect(listCalls).toBe(3)
    expect(snapshot!.refreshing).toBe(true)

    await act(async () => {
      firstRefresh.resolve(success({ sessions: [], issues: [] }))
      await older
    })
    expect(snapshot!.refreshing).toBe(true)
    await act(async () => {
      secondRefresh.resolve(success({ sessions: [], issues: [] }))
      await newer
    })
    expect(snapshot!.refreshing).toBe(false)
    act(() => renderer.unmount())
  })
})
