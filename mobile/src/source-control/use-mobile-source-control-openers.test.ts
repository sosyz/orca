import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { MobileGitStatusEntry } from './mobile-git-status'
import { buildMobileReviewFileRoute } from './mobile-review-route'
import { useMobileSourceControlOpeners } from './use-mobile-source-control-openers'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  triggerSelection: vi.fn(),
  triggerError: vi.fn(),
  reveal: vi.fn()
}))

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: mocks.back })
}))

vi.mock('../platform/haptics', () => ({
  triggerSelection: mocks.triggerSelection,
  triggerError: mocks.triggerError
}))

vi.mock('./reveal-mobile-source-control-session-diff', () => ({
  revealMobileSourceControlSessionDiff: mocks.reveal
}))

type Openers = ReturnType<typeof useMobileSourceControlOpeners>
type OpenersParams = Parameters<typeof useMobileSourceControlOpeners>[0]

function failure(code: string, message: string): RpcResponse {
  return { id: 'rpc-1', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function clientWith(sendRequest: RpcClient['sendRequest']): RpcClient {
  return {
    sendRequest,
    subscribe: vi.fn(),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => 1,
    onStateChange: () => () => {},
    notifyForeground: vi.fn(),
    close: vi.fn()
  }
}

function statusEntry(overrides: Partial<MobileGitStatusEntry> = {}): MobileGitStatusEntry {
  return { path: 'src/example.ts', status: 'modified', area: 'unstaged', ...overrides }
}

function makeOptions(overrides: Partial<OpenersParams> = {}): OpenersParams {
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  return {
    client: clientWith(sendRequest),
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'wt-1',
    name: 'Orca',
    origin: 'session',
    embedded: false,
    branchCompareState: { kind: 'idle' },
    mountedRef: { current: true },
    busyActionRef: { current: null },
    setActionError: vi.fn(),
    ...overrides
  }
}

function rendererUnavailable(): RpcResponse {
  return failure('runtime_error', 'renderer_unavailable')
}

describe('useMobileSourceControlOpeners', () => {
  let renderer: ReactTestRenderer | null = null
  let openers: Openers | null = null

  function Harness({ options }: { options: OpenersParams }): null {
    openers = useMobileSourceControlOpeners(options)
    return null
  }

  function mount(options: OpenersParams) {
    act(() => {
      renderer = create(createElement(Harness, { options }))
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reveal.mockResolvedValue('revealed')
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    openers = null
  })

  it('replaces session source control with local review when openDiff has no renderer', async () => {
    const events: string[] = []
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockImplementation(async (method) => {
      events.push(method)
      return rendererUnavailable()
    })
    const options = makeOptions({
      client: clientWith(sendRequest),
      onFileOpenStart: () => events.push('snapshot')
    })
    mount(options)

    await act(async () => {
      await openers!.openFile(statusEntry({ area: 'staged' }))
    })

    expect(events).toEqual(['snapshot', 'files.openDiff'])
    expect(sendRequest).toHaveBeenCalledWith('files.openDiff', {
      worktree: 'id:wt-1',
      relativePath: 'src/example.ts',
      staged: true
    })
    expect(mocks.replace).toHaveBeenCalledWith(
      buildMobileReviewFileRoute({
        hostId: 'host-1',
        worktreeId: 'wt-1',
        worktreeName: 'Orca',
        filePath: 'src/example.ts',
        area: 'staged'
      })
    )
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('opens local review and closes the embedded dock on renderer-unavailable openDiff', async () => {
    const onRequestClose = vi.fn()
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockResolvedValue(rendererUnavailable())
    mount(
      makeOptions({
        client: clientWith(sendRequest),
        embedded: true,
        onRequestClose
      })
    )

    await act(async () => {
      await openers!.openFile(statusEntry({ area: 'unstaged' }))
    })

    expect(mocks.push).toHaveBeenCalledWith(
      buildMobileReviewFileRoute({
        hostId: 'host-1',
        worktreeId: 'wt-1',
        worktreeName: 'Orca',
        filePath: 'src/example.ts',
        area: 'unstaged'
      })
    )
    expect(onRequestClose).toHaveBeenCalledOnce()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.back).not.toHaveBeenCalled()
  })

  it('does not turn ordinary file errors into a review fallback', async () => {
    const setActionError = vi.fn()
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockResolvedValue(failure('invalid_argument', 'invalid_relative_path'))
    mount(makeOptions({ client: clientWith(sendRequest), setActionError }))

    await act(async () => {
      await openers!.openFile(statusEntry())
    })

    expect(sendRequest).toHaveBeenCalledOnce()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(setActionError).toHaveBeenLastCalledWith('invalid_relative_path')
    expect(mocks.triggerError).toHaveBeenCalledOnce()
  })

  it('does not navigate if the renderer-unavailable response arrives after unmount', async () => {
    const pending = deferred<RpcResponse>()
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockReturnValue(pending.promise)
    const mountedRef = { current: true }
    const options = makeOptions({ client: clientWith(sendRequest), mountedRef })
    mount(options)

    let openPromise: Promise<void> | null = null
    await act(async () => {
      openPromise = openers!.openFile(statusEntry())
      await Promise.resolve()
    })
    mountedRef.current = false
    act(() => renderer?.unmount())

    await act(async () => {
      pending.resolve(rendererUnavailable())
      await openPromise
    })

    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.triggerError).not.toHaveBeenCalled()
  })

  it('uses tap-time route data when the same source is renamed before openDiff resolves', async () => {
    const pending = deferred<RpcResponse>()
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockReturnValue(pending.promise)
    const options = makeOptions({
      client: clientWith(sendRequest),
      worktreeId: 'wt-before',
      name: 'Before'
    })
    mount(options)

    let openPromise: Promise<void> | null = null
    await act(async () => {
      openPromise = openers!.openFile(statusEntry({ area: 'staged' }))
      await Promise.resolve()
    })
    act(() => {
      renderer!.update(
        createElement(Harness, {
          options: { ...options, name: 'After' }
        })
      )
    })

    await act(async () => {
      pending.resolve(rendererUnavailable())
      await openPromise
    })

    expect(mocks.replace).toHaveBeenCalledWith(
      buildMobileReviewFileRoute({
        hostId: 'host-1',
        worktreeId: 'wt-before',
        worktreeName: 'Before',
        filePath: 'src/example.ts',
        area: 'staged'
      })
    )
  })

  it('does not navigate for a previous worktree after the hook adopts another', async () => {
    const pending = deferred<RpcResponse>()
    const options = makeOptions({ client: clientWith(vi.fn().mockReturnValue(pending.promise)) })
    mount(options)
    let opening!: Promise<void>
    await act(async () => {
      opening = openers!.openFile(statusEntry())
    })
    act(() => {
      renderer!.update(createElement(Harness, { options: { ...options, worktreeId: 'wt-after' } }))
    })
    await act(async () => {
      pending.resolve(rendererUnavailable())
      await opening
    })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not show an old openDiff close error after the same worktree adopts a new client', async () => {
    const pending = deferred<RpcResponse>()
    const setActionError = vi.fn()
    const options = makeOptions({
      client: clientWith(vi.fn().mockReturnValue(pending.promise)),
      setActionError
    })
    mount(options)
    let opening!: Promise<void>
    await act(async () => {
      opening = openers!.openFile(statusEntry())
    })

    act(() => {
      pending.reject(new Error('Client closed'))
      renderer!.update(
        createElement(Harness, {
          options: { ...options, client: clientWith(vi.fn().mockResolvedValue({})) }
        })
      )
    })
    await act(async () => opening)

    expect(setActionError).not.toHaveBeenCalledWith('Client closed')
    expect(mocks.triggerError).not.toHaveBeenCalled()
  })

  it('does not show an old branch preview error after the same worktree adopts a new client', async () => {
    const pending = deferred<RpcResponse>()
    const options = makeOptions({
      client: clientWith(vi.fn().mockReturnValue(pending.promise)),
      branchCompareState: {
        kind: 'ready',
        result: {
          summary: {
            status: 'ready',
            baseRef: 'main',
            baseOid: 'base',
            compareRef: 'HEAD',
            headOid: 'head',
            mergeBase: 'base',
            changedFiles: 1
          },
          entries: [{ path: 'src/example.ts', status: 'modified' }]
        }
      }
    })
    mount(options)
    let opening!: Promise<void>
    await act(async () => {
      opening = openers!.openBranchDiff({ path: 'src/example.ts', status: 'modified' })
    })

    act(() => {
      pending.reject(new Error('Client closed'))
      renderer!.update(
        createElement(Harness, {
          options: { ...options, client: clientWith(vi.fn().mockResolvedValue({})) }
        })
      )
    })
    await act(async () => opening)

    expect(openers!.branchDiffPreview).not.toMatchObject({
      kind: 'error',
      message: 'Client closed'
    })
    expect(mocks.triggerError).not.toHaveBeenCalled()
  })

  it('does not accept an old response after disconnected and connected visits to the same client', async () => {
    const pending = deferred<RpcResponse>()
    const options = makeOptions({ client: clientWith(vi.fn().mockReturnValue(pending.promise)) })
    mount(options)
    let opening!: Promise<void>
    await act(async () => {
      opening = openers!.openFile(statusEntry())
    })
    act(() => {
      renderer!.update(
        createElement(Harness, { options: { ...options, connState: 'disconnected' } })
      )
    })
    act(() => {
      renderer!.update(createElement(Harness, { options }))
    })
    await act(async () => {
      pending.resolve(rendererUnavailable())
      await opening
    })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not release a new client opening when an old same-path request settles', async () => {
    const oldPending = deferred<RpcResponse>()
    const newPending = deferred<RpcResponse>()
    const oldOptions = makeOptions({
      client: clientWith(vi.fn().mockReturnValue(oldPending.promise))
    })
    mount(oldOptions)
    let oldOpening!: Promise<void>
    await act(async () => {
      oldOpening = openers!.openFile(statusEntry())
    })
    act(() => {
      renderer!.update(
        createElement(Harness, {
          options: {
            ...oldOptions,
            client: clientWith(vi.fn().mockReturnValue(newPending.promise))
          }
        })
      )
    })
    let newOpening!: Promise<void>
    await act(async () => {
      newOpening = openers!.openFile(statusEntry())
    })
    await act(async () => {
      oldPending.reject(new Error('Client closed'))
      await oldOpening
    })
    expect(openers!.openingPath).toBe('src/example.ts')
    await act(async () => {
      newPending.resolve({
        id: 'request',
        ok: true,
        result: {},
        _meta: { runtimeId: 'host' }
      })
      await newOpening
    })
    expect(openers!.openingPath).toBeNull()
  })
})
