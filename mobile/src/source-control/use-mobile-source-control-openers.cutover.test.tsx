import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileSourceControlOpeners } from './use-mobile-source-control-openers'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('expo-router', () => ({ useRouter: () => router }))
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn(), triggerError: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function ok(result: unknown): RpcResponse {
  return { id: 'test', ok: true, result, _meta: { runtimeId: 'host' } }
}

describe('source-control file activation across logical client cutover', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.clearAllMocks()
  })

  async function startOpening(sendRequest: RpcClient['sendRequest']) {
    const mountedRef = { current: true }
    const busyActionRef = { current: null }
    const client = { sendRequest } as RpcClient
    let openers!: ReturnType<typeof useMobileSourceControlOpeners>
    function Probe() {
      openers = useMobileSourceControlOpeners({
        client,
        connState: 'connected',
        hostId: 'host',
        worktreeId: 'wt',
        name: 'Repo',
        origin: 'session',
        embedded: false,
        branchCompareState: { kind: 'idle' },
        mountedRef,
        busyActionRef,
        setActionError: vi.fn()
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    return {
      mountedRef,
      open: () => openers.openFile({ path: 'a.ts', status: 'modified', area: 'unstaged' })
    }
  }

  it('does not retry old session tab activation after the opener unmounts', async () => {
    const firstActivation = deferred<RpcResponse>()
    const reachedActivation = deferred<void>()
    const sendRequest = vi.fn<RpcClient['sendRequest']>(async (method) => {
      if (method === 'files.openDiff') {
        return ok({})
      }
      if (method === 'session.tabs.list') {
        return ok({
          tabs: [
            {
              id: 'file-a',
              type: 'file',
              mode: 'diff',
              diffSource: 'unstaged',
              relativePath: 'a.ts'
            }
          ]
        })
      }
      if (method === 'session.tabs.activate') {
        reachedActivation.resolve()
        return firstActivation.promise
      }
      throw new Error(method)
    })
    const { mountedRef, open } = await startOpening(sendRequest)
    let opening!: Promise<void>
    await act(async () => {
      opening = open()
      await reachedActivation.promise
    })
    mountedRef.current = false
    act(() => renderer?.unmount())
    await act(async () => {
      firstActivation.reject(new LogicalClientCutoverError())
      await opening
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.activate')
    ).toHaveLength(1)
    expect(router.back).not.toHaveBeenCalled()
  })

  it('still retries an activation cutover while the opener owns the same source', async () => {
    const firstActivation = deferred<RpcResponse>()
    const reachedActivation = deferred<void>()
    let activationCount = 0
    const sendRequest = vi.fn<RpcClient['sendRequest']>(async (method) => {
      if (method === 'files.openDiff') {
        return ok({})
      }
      if (method === 'session.tabs.list') {
        return ok({
          tabs: [
            {
              id: 'file-a',
              type: 'file',
              mode: 'diff',
              diffSource: 'unstaged',
              relativePath: 'a.ts'
            }
          ]
        })
      }
      if (method === 'session.tabs.activate') {
        if (++activationCount === 1) {
          reachedActivation.resolve()
          return firstActivation.promise
        }
        return ok({ activeTabId: 'file-a' })
      }
      throw new Error(method)
    })
    const { open } = await startOpening(sendRequest)
    let opening!: Promise<void>
    await act(async () => {
      opening = open()
      await reachedActivation.promise
    })
    await act(async () => {
      firstActivation.reject(new LogicalClientCutoverError())
      await opening
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.activate')
    ).toHaveLength(2)
    expect(router.back).toHaveBeenCalledOnce()
  })
})
