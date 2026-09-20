import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'
import { normalizeMobileDiffComments } from './mobile-diff-comments'
import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'

const { loadSnapshot, loadDiff } = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  loadDiff: vi.fn()
}))
vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: loadSnapshot,
  loadMobileDiffReviewDiff: loadDiff
}))
vi.mock('./use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: () => ({})
}))
vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerSuccess: vi.fn(),
  triggerSelection: vi.fn()
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))

const NOTE: DiffComment = {
  id: 'note-a',
  worktreeId: 'wt-a',
  filePath: 'same.ts',
  lineNumber: 1,
  body: 'original note',
  createdAt: 1,
  side: 'modified'
}
const OK = { id: 'ok', ok: true as const, result: {} }
function snapshot(worktreeId = 'wt-a', id = 'note-a'): ReviewScreenState {
  return {
    kind: 'ready',
    status: {
      entries: [{ area: 'unstaged', status: 'modified', path: 'same.ts', added: 1, removed: 0 }],
      conflictOperation: 'none',
      branch: id
    },
    comments: normalizeMobileDiffComments([{ ...NOTE, id, worktreeId }], worktreeId),
    reviewState: { version: 1, files: {} },
    branchCompare: null
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type Controller = ReturnType<typeof useMobileDiffReviewController>
type Input = Parameters<typeof useMobileDiffReviewController>[0]
let renderer: ReactTestRenderer | null = null
function mount(client: RpcClient) {
  let input: Input = {
    client,
    connState: 'connected',
    hostId: 'host-a',
    worktreeId: 'wt-a',
    name: 'Review',
    initialFilter: 'all',
    initialTarget: null,
    onOpenSession: vi.fn(),
    onReconnect: vi.fn()
  }
  let controller!: Controller
  const committed: Controller[] = []
  function Probe() {
    controller = useMobileDiffReviewController(input)
    useLayoutEffect(() => {
      committed.push(controller)
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return {
    get controller() {
      return controller
    },
    committed,
    async update(patch: Partial<Input>) {
      await act(async () => {
        input = { ...input, ...patch }
        renderer?.update(createElement(Probe))
      })
    }
  }
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
  loadSnapshot.mockReset()
  loadDiff.mockReset()
})

describe('diff review snapshot ownership', () => {
  it.each(['client', 'host', 'worktree'] as const)(
    'hides the previous review and action targets on the first committed %s change',
    async (change) => {
      const pending = deferred<ReviewScreenState>()
      const pendingDiff = deferred<unknown>()
      loadSnapshot.mockResolvedValueOnce(snapshot()).mockReturnValueOnce(pending.promise)
      loadDiff
        .mockImplementationOnce(({ item }) =>
          Promise.resolve({
            kind: 'ready',
            itemKey: item.key,
            lines: [],
            hunks: [],
            truncated: false
          })
        )
        .mockReturnValue(pendingDiff.promise)
      const sendRequest = vi.fn().mockResolvedValue(OK)
      const client = { sendRequest } as unknown as RpcClient
      const current = mount(client)
      await act(async () => {})
      expect(current.controller.screenState.kind).toBe('ready')
      const item = current.controller.currentItem!
      act(() => {
        current.controller.openComposer(1)
        current.controller.setSendSheet({ kind: 'ready', terminals: [] })
        current.controller.setDiscardTarget(item)
      })
      act(() => current.controller.setComposerBody('previous draft'))
      current.committed.length = 0
      const nextWorktree = change === 'worktree' ? 'wt-b' : 'wt-a'
      await current.update(
        change === 'client'
          ? { client: { sendRequest } as unknown as RpcClient }
          : change === 'host'
            ? { hostId: 'host-b' }
            : { worktreeId: nextWorktree }
      )

      for (const frame of current.committed) {
        expect(frame.screenState.kind).not.toBe('ready')
        expect(frame.queue).toEqual([])
        expect(frame.diffState.kind).not.toBe('ready')
        expect(frame.composer).toBeNull()
        expect(frame.composerBody).toBe('')
        expect(frame.sendSheet).toBeNull()
        expect(frame.discardTarget).toBeNull()
      }
      await act(async () => {
        await current.controller.markReviewed()
      })
      expect(sendRequest).not.toHaveBeenCalled()
      await act(async () => {
        pending.resolve(snapshot(nextWorktree, 'note-b'))
      })
      expect(current.controller.unsentComments.map((note) => note.id)).toEqual(['note-b'])
      expect(current.controller.diffState.kind).toBe('loading')
      await act(async () => {
        pendingDiff.resolve({
          kind: 'ready',
          itemKey: current.controller.currentItem!.key,
          lines: [],
          hunks: [],
          truncated: false
        })
      })
      expect(current.controller.diffState.kind).toBe('ready')
    }
  )

  it('ignores a load from before switching away and back to the same source', async () => {
    const old = deferred<ReviewScreenState>()
    const latest = deferred<ReviewScreenState>()
    loadSnapshot
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(snapshot('wt-b', 'note-b'))
      .mockReturnValueOnce(latest.promise)
    loadDiff.mockResolvedValue({ kind: 'idle' })
    const current = mount({ sendRequest: vi.fn() } as unknown as RpcClient)
    const oldRetry = current.controller.retryAction
    await current.update({ worktreeId: 'wt-b' })
    await current.update({ worktreeId: 'wt-a' })
    act(() => oldRetry())
    expect(loadSnapshot).toHaveBeenCalledTimes(3)
    await act(async () => {
      old.resolve(snapshot())
    })
    expect(current.controller.screenState.kind).not.toBe('ready')
    await act(async () => {
      latest.resolve(snapshot('wt-a', 'new-a'))
    })
    expect(current.controller.unsentComments.map((note) => note.id)).toEqual(['new-a'])
  })

  it('marks an unchanged reloaded note sent after stage finishes during delivery', async () => {
    const pendingSend = deferred<typeof OK>()
    loadSnapshot.mockImplementation(async () => snapshot())
    loadDiff.mockResolvedValue({ kind: 'idle' })
    const sendRequest = vi.fn((method: string) =>
      method === 'terminal.send' ? pendingSend.promise : Promise.resolve(OK)
    )
    const current = mount({ sendRequest } as unknown as RpcClient)
    await act(async () => {})
    const submitted = current.controller.unsentComments
    let sending!: Promise<void>
    await act(async () => {
      sending = current.controller.sendPromptToTerminal('terminal-a', submitted)
    })
    act(() => current.controller.setSendSheet(null))
    await act(async () => {
      await current.controller.runGitMutation('git.stage', current.controller.currentItem!)
    })
    expect(current.controller.unsentComments[0]).not.toBe(submitted[0])
    await act(async () => {
      pendingSend.resolve(OK)
      await sending
    })
    expect(current.controller.unsentComments).toEqual([])
    expect(sendRequest).toHaveBeenCalledWith(
      'worktree.set',
      expect.objectContaining({
        diffComments: [expect.objectContaining({ id: 'note-a', sentAt: expect.any(Number) })]
      })
    )
  })
})
