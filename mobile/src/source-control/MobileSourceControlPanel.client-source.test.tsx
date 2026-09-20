import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileSourceControlLoaders } from './use-mobile-source-control-loaders'
import { MobileSourceControlPanel } from './MobileSourceControlPanel'

const mocks = vi.hoisted(() => ({
  client: null as RpcClient | null,
  connState: 'connected' as ConnectionState,
  branchCard: null as null | { branchLabel: string; prChip: unknown },
  prInput: null as null | { branch: string | null; client: RpcClient | null },
  screenKind: '' as string,
  loadStatus: null as null | ((options?: { force?: boolean }) => Promise<boolean>),
  setActionError: vi.fn(),
  probe: vi.fn(),
  prForBranch: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Pressable: () => null,
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: () => null,
  View: ({ children }: { children?: ReactNode }) => createElement('View', null, children)
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('View', null, children)
}))
vi.mock('lucide-react-native', () => ({
  ArrowDown: () => null,
  ArrowDownUp: () => null,
  ArrowUp: () => null,
  Check: () => null,
  CloudUpload: () => null,
  GitBranch: () => null,
  GitPullRequestArrow: () => null,
  History: () => null,
  RefreshCw: () => null
}))
vi.mock('./use-mobile-source-control-state', () => ({
  useMobileSourceControlState: ({ hostId, worktreeId }: { hostId: string; worktreeId: string }) => {
    const { screenState, loadStatus, setRootRef } = useMobileSourceControlLoaders({
      client: mocks.client,
      connState: mocks.connState,
      statusIdentityKey: `${hostId}\0${worktreeId}`,
      worktreeId,
      setActionError: mocks.setActionError
    })
    const status = screenState.kind === 'ready' ? screenState.status : null
    mocks.screenKind = screenState.kind
    mocks.loadStatus = loadStatus
    return {
      client: mocks.client,
      connState: mocks.connState,
      forceReconnect: vi.fn(),
      insets: { bottom: 0 },
      router: { back: vi.fn() },
      setRootRef,
      worktreeLabel: worktreeId,
      screenState,
      busyAction: null,
      openingPath: null,
      openingBranchPath: null,
      loadStatus,
      status,
      branchCompareResult: null,
      branchLabel: status?.branch ?? '',
      syncLabel: null,
      unstagedCount: 0,
      stagedCount: 0,
      branchEntries: [],
      abortConflictOperation: vi.fn()
    }
  }
}))
vi.mock('./use-mobile-source-control-action-sheet', () => ({
  useMobileSourceControlActionSheet: () => []
}))
vi.mock('./MobileSourceControlHeader', () => ({ MobileSourceControlHeader: () => null }))
vi.mock('./MobileSourceControlSegments', () => ({ MobileSourceControlSegments: () => null }))
vi.mock('./MobileSourceControlContent', () => ({ MobileSourceControlContent: () => null }))
vi.mock('./MobileSourceControlModals', () => ({ MobileSourceControlModals: () => null }))
vi.mock('./MobileGitHistoryList', () => ({ MobileGitHistoryList: () => null }))
vi.mock('../components/pr-sidebar/MobilePrViewPanel', () => ({ MobilePrViewPanelBody: () => null }))
vi.mock('./MobileSourceControlBranchCard', () => ({
  MobileSourceControlBranchCard: (props: { branchLabel: string; prChip: unknown }) => {
    mocks.branchCard = { branchLabel: props.branchLabel, prChip: props.prChip }
    return null
  }
}))
vi.mock('../session/github-pr-rpc', () => ({
  fetchGithubRepoSlug: (...args: unknown[]) => mocks.probe(...args),
  fetchHostedReviewForBranch: async () => ({ ok: true, result: null }),
  fetchPRForBranch: (...args: unknown[]) => mocks.prForBranch(...args),
  fetchPRChecks: async () => ({ ok: true, result: [] }),
  fetchWorkItemDetails: async () => ({ ok: true, result: null })
}))
vi.mock('./mobile-pr-link', () => ({ fetchWorktreeLinkedPR: async () => null }))
vi.mock('../session/use-mobile-pr-sidebar-controller', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../session/use-mobile-pr-sidebar-controller')>()
  return {
    ...actual,
    useMobilePrSidebarController: (
      input: Parameters<typeof actual.useMobilePrSidebarController>[0]
    ) => {
      mocks.prInput = { branch: input.branch, client: input.client }
      return actual.useMobilePrSidebarController(input)
    }
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Source Control client replacement', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mocks.client = null
    mocks.connState = 'connected'
    mocks.branchCard = null
    mocks.prInput = null
    mocks.screenKind = ''
    mocks.loadStatus = null
    mocks.probe.mockReset()
    mocks.prForBranch.mockReset()
  })

  it('does not bootstrap a replacement client PR from the previous client branch while status is pending', async () => {
    const nextStatus = deferred<{ ok: true; result: unknown }>()
    const nextProbe = deferred<{ ok: true; result: { owner: string; repo: string } }>()
    const oldClient = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'git.status'
          ? { ok: true, result: { branch: 'refs/heads/old', head: 'old-head', entries: [] } }
          : { ok: false }
      )
    } as unknown as RpcClient
    const replacementClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.status' ? nextStatus.promise : Promise.resolve({ ok: false })
      )
    } as unknown as RpcClient
    mocks.probe.mockImplementation((client: RpcClient) =>
      client === oldClient
        ? Promise.resolve({ ok: true, result: { owner: 'owner', repo: 'repo' } })
        : nextProbe.promise
    )
    mocks.prForBranch.mockResolvedValue({ ok: true, result: null })
    mocks.client = oldClient
    await act(async () => {
      renderer = create(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(mocks.screenKind).toBe('ready')
    expect(mocks.branchCard?.branchLabel).toBe('refs/heads/old')

    mocks.client = replacementClient
    mocks.branchCard = null
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(replacementClient.sendRequest).toHaveBeenCalledWith('git.status', {
      worktree: 'id:wt'
    })
    expect(mocks.prInput).toEqual({ branch: null, client: replacementClient })
    await act(async () => nextProbe.resolve({ ok: true, result: { owner: 'owner', repo: 'repo' } }))

    expect(mocks.prForBranch).not.toHaveBeenCalledWith(replacementClient, 'wt', {
      branch: 'refs/heads/old',
      linkedPRNumber: null
    })
    expect(mocks.screenKind).not.toBe('ready')
    expect(mocks.branchCard?.branchLabel).not.toBe('refs/heads/old')

    await act(async () =>
      nextStatus.resolve({
        ok: true,
        result: { branch: 'refs/heads/new', head: 'new-head', entries: [] }
      })
    )
    expect(mocks.screenKind).toBe('ready')
    expect(mocks.branchCard?.branchLabel).toBe('refs/heads/new')
    expect(mocks.prForBranch).toHaveBeenCalledWith(replacementClient, 'wt', {
      branch: 'refs/heads/new',
      linkedPRNumber: null
    })
  })

  it('keeps the branch fallback for a temporary disconnect of the same client', async () => {
    const reconnectStatus = deferred<{ ok: true; result: unknown }>()
    let statusReads = 0
    const client = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.status'
          ? ++statusReads === 1
            ? Promise.resolve({
                ok: true,
                result: { branch: 'refs/heads/same', head: 'head', entries: [] }
              })
            : reconnectStatus.promise
          : Promise.resolve({ ok: false })
      )
    } as unknown as RpcClient
    mocks.client = client
    mocks.probe.mockResolvedValue({ ok: true, result: null })
    await act(async () => {
      renderer = create(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(mocks.prInput).toEqual({ branch: 'refs/heads/same', client })

    mocks.connState = 'disconnected'
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(mocks.prInput).toEqual({ branch: 'refs/heads/same', client })

    mocks.connState = 'connected'
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(mocks.prInput).toEqual({ branch: 'refs/heads/same', client })
    await act(async () =>
      reconnectStatus.resolve({
        ok: true,
        result: { branch: 'refs/heads/same', head: 'head', entries: [] }
      })
    )
    expect(mocks.screenKind).toBe('ready')
  })

  it('does not let a completed old action invalidate the replacement status read', async () => {
    const nextStatus = deferred<{ ok: true; result: unknown }>()
    const oldClient = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'git.status'
          ? { ok: true, result: { branch: 'refs/heads/old', head: 'old', entries: [] } }
          : { ok: false }
      )
    } as unknown as RpcClient
    const nextClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.status' ? nextStatus.promise : Promise.resolve({ ok: false })
      )
    } as unknown as RpcClient
    mocks.client = oldClient
    mocks.probe.mockResolvedValue({ ok: true, result: null })
    await act(async () => {
      renderer = create(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    const oldActionRefresh = mocks.loadStatus!
    mocks.client = nextClient
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    await act(async () => {
      expect(await oldActionRefresh({ force: true })).toBe(false)
    })
    await act(async () => {
      nextStatus.resolve({
        ok: true,
        result: { branch: 'refs/heads/current', head: 'current', entries: [] }
      })
    })
    expect(mocks.screenKind).toBe('ready')
    expect(mocks.branchCard?.branchLabel).toBe('refs/heads/current')
  })

  it('does not accept an old client result after client A to B to A replacement', async () => {
    const staleStatus = deferred<{ ok: true; result: unknown }>()
    const replacementStatus = deferred<{ ok: true; result: unknown }>()
    let aReads = 0
    const clientA = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.status'
          ? Promise.resolve(++aReads).then((read) =>
              read === 2
                ? staleStatus.promise
                : {
                    ok: true,
                    result: {
                      branch: read === 1 ? 'refs/heads/first' : 'refs/heads/latest',
                      head: `head-${read}`,
                      entries: []
                    }
                  }
            )
          : Promise.resolve({ ok: false })
      )
    } as unknown as RpcClient
    const clientB = {
      sendRequest: vi.fn((method: string) =>
        method === 'git.status' ? replacementStatus.promise : Promise.resolve({ ok: false })
      )
    } as unknown as RpcClient
    mocks.probe.mockResolvedValue({ ok: true, result: null })
    mocks.client = clientA
    await act(async () => {
      renderer = create(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    const firstVisitRefresh = mocks.loadStatus!
    let oldLoad!: Promise<boolean>
    await act(async () => {
      oldLoad = mocks.loadStatus!({ force: true })
    })

    mocks.client = clientB
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    mocks.client = clientA
    await act(async () => {
      renderer!.update(
        createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'wt' })
      )
    })
    expect(mocks.branchCard?.branchLabel).toBe('refs/heads/latest')
    await act(async () => {
      expect(await firstVisitRefresh({ force: true })).toBe(false)
    })

    await act(async () => {
      staleStatus.resolve({
        ok: true,
        result: { branch: 'refs/heads/stale', head: 'stale-head', entries: [] }
      })
      await oldLoad
    })
    expect(mocks.branchCard?.branchLabel).toBe('refs/heads/latest')
  })
})
