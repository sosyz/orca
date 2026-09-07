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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it('uses tap-time route data when props change before openDiff resolves', async () => {
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
          options: { ...options, worktreeId: 'wt-after', name: 'After' }
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
})
