import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'
import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'

const { loadSnapshot } = vi.hoisted(() => ({ loadSnapshot: vi.fn() }))
vi.mock('./mobile-diff-review-loaders', async (importActual) => ({
  ...(await importActual<object>()),
  loadMobileDiffReviewSnapshot: loadSnapshot
}))
vi.mock('./use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: () => ({})
}))
vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerSuccess: vi.fn(),
  triggerSelection: vi.fn()
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))

function unstagedSnapshot(added = 1): ReviewScreenState {
  return {
    kind: 'ready',
    status: {
      entries: [{ area: 'unstaged', status: 'modified', path: 'same.ts', added, removed: 0 }],
      conflictOperation: 'none'
    },
    comments: [],
    reviewState: { version: 1, files: {} },
    branchCompare: null
  } as ReviewScreenState
}

function branchSnapshot(headOid: string, baseRef = 'main'): ReviewScreenState {
  return {
    kind: 'ready',
    status: { entries: [], conflictOperation: 'none' },
    comments: [],
    reviewState: { version: 1, files: {} },
    branchCompare: {
      summary: {
        baseRef,
        baseOid: 'base',
        compareRef: 'feature',
        headOid,
        mergeBase: 'base',
        changedFiles: 1,
        status: 'ready'
      },
      entries: [{ path: 'same.ts', status: 'modified', added: 1, removed: 0 }]
    }
  } as ReviewScreenState
}

type Input = Parameters<typeof useMobileDiffReviewController>[0]
type Controller = ReturnType<typeof useMobileDiffReviewController>

describe('diff review RPC freshness', () => {
  let renderer: ReactTestRenderer | null = null
  let latest!: Controller
  let input: Input
  let sendRequest: ReturnType<typeof vi.fn>
  let snapshots: Controller[]
  let diffContent: string

  function Probe() {
    latest = useMobileDiffReviewController(input)
    useLayoutEffect(() => {
      snapshots.push(latest)
    })
    return null
  }
  async function render(patch: Partial<Input> = {}) {
    input = { ...input, ...patch }
    await act(async () => {
      const element = createElement(Probe)
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }
  function rpcCount(method: string) {
    return sendRequest.mock.calls.filter(([name]) => name === method).length
  }
  async function addComment() {
    act(() => latest.openComposer(1))
    act(() => latest.setComposerBody('A note'))
    await act(async () => {
      await latest.saveComposer()
    })
  }

  beforeEach(() => {
    loadSnapshot.mockReset()
    diffContent = 'before'
    snapshots = []
    sendRequest = vi.fn(async (method: string) => {
      if (method === 'git.diff' || method === 'git.branchDiff') {
        return {
          id: method,
          ok: true,
          result: { kind: 'text', originalContent: 'original', modifiedContent: diffContent }
        }
      }
      if (method === 'worktree.set') {
        return { id: method, ok: true, result: {} }
      }
      throw new Error(`Unexpected ${method}`)
    })
    input = {
      client: { sendRequest } as unknown as RpcClient,
      connState: 'connected',
      hostId: 'host-a',
      worktreeId: 'wt-a',
      name: 'Review',
      initialFilter: 'all',
      initialTarget: null,
      onOpenSession: vi.fn(),
      onReconnect: vi.fn()
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not refetch a whole file for notes or reviewed metadata, but reloads a fresh status', async () => {
    loadSnapshot
      .mockResolvedValueOnce(unstagedSnapshot())
      .mockResolvedValueOnce(unstagedSnapshot())
      .mockResolvedValueOnce(unstagedSnapshot(2))
    await render()
    expect(rpcCount('git.diff')).toBe(1)
    const firstIdentity = latest.currentItem!.diffIdentity

    await addComment()
    expect(rpcCount('worktree.set')).toBe(1)
    expect(rpcCount('git.diff')).toBe(1)
    await act(async () => {
      await latest.markReviewed()
    })
    expect(rpcCount('worktree.set')).toBe(2)
    expect(rpcCount('git.diff')).toBe(1)

    diffContent = 'changed with the same status counts'
    await act(async () => {
      latest.retryAction()
      await Promise.resolve()
    })
    expect(latest.currentItem!.diffIdentity).toBe(firstIdentity)
    expect(rpcCount('git.diff')).toBe(2)
    expect(latest.diffState.kind).toBe('ready')

    await act(async () => {
      latest.retryAction()
      await Promise.resolve()
    })
    expect(latest.currentItem!.diffIdentity).not.toBe(firstIdentity)
    expect(rpcCount('git.diff')).toBe(3)
  })

  it('does not refetch branch contents for a note but follows a changed branch reference', async () => {
    loadSnapshot
      .mockResolvedValueOnce(branchSnapshot('head-a'))
      .mockResolvedValueOnce(branchSnapshot('head-b', 'release'))
    await render()
    expect(rpcCount('git.branchDiff')).toBe(1)
    await addComment()
    expect(rpcCount('worktree.set')).toBe(1)
    expect(rpcCount('git.branchDiff')).toBe(1)

    await act(async () => {
      latest.retryAction()
      await Promise.resolve()
    })
    expect(rpcCount('git.branchDiff')).toBe(2)
    expect(sendRequest).toHaveBeenLastCalledWith(
      'git.branchDiff',
      expect.objectContaining({
        compare: expect.objectContaining({ baseRef: 'release', headOid: 'head-b' })
      })
    )
  })

  it('keeps the same-source diff visible through a blip and refreshes after reconnect', async () => {
    loadSnapshot.mockResolvedValueOnce(unstagedSnapshot()).mockResolvedValueOnce(unstagedSnapshot())
    await render()
    expect(rpcCount('git.diff')).toBe(1)
    snapshots = []
    await render({ connState: 'reconnecting' as ConnectionState })
    expect(snapshots.every((frame) => frame.diffState.kind === 'ready')).toBe(true)
    expect(rpcCount('git.diff')).toBe(1)
    await render({ connState: 'connected' })
    expect(latest.diffState.kind).toBe('ready')
    expect(rpcCount('git.diff')).toBeGreaterThan(1)
  })

  it('does not expose the prior host diff on the first commit of a source change', async () => {
    loadSnapshot.mockResolvedValueOnce(unstagedSnapshot()).mockResolvedValueOnce(unstagedSnapshot())
    await render()
    expect(latest.diffState.kind).toBe('ready')
    snapshots = []
    await render({ hostId: 'host-b' })
    expect(snapshots[0]?.diffState.kind).not.toBe('ready')
    expect(rpcCount('git.diff')).toBe(2)
  })
})
