import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ComposerState, ReviewScreenState } from './mobile-diff-review-screen-model'
import type { MobileDiffReviewQueueItem } from './mobile-diff-review-queue'
import { useMobileDiffReviewCommentActions } from './use-mobile-diff-review-comment-actions'
import { useMobileDiffReviewSendActions } from './use-mobile-diff-review-send-actions'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))

const ORIGINAL: DiffComment = {
  id: 'one',
  worktreeId: 'wt-a',
  filePath: 'src/a.ts',
  lineNumber: 1,
  body: 'original',
  createdAt: 1,
  side: 'modified'
}
const SECOND: DiffComment = { ...ORIGINAL, id: 'two', body: 'second', lineNumber: 2 }
const ADDED: DiffComment = { ...ORIGINAL, id: 'three', body: 'newer', lineNumber: 3 }
const REVIEW_STATE = { version: 1 as const, files: {} }

function ready(comments: DiffComment[]): ReviewScreenState {
  return {
    kind: 'ready',
    status: { entries: [], conflictOperation: 'none' },
    branchCompare: null,
    comments,
    reviewState: REVIEW_STATE
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useMobileDiffReviewCommentActions', () => {
  let renderer: ReactTestRenderer | null = null
  let client: RpcClient
  let worktreeId = 'wt-a'
  let state: ReviewScreenState = ready([ORIGINAL])
  let actions: ReturnType<typeof useMobileDiffReviewCommentActions>
  let sendActions: ReturnType<typeof useMobileDiffReviewSendActions>
  let setState: (next: ReviewScreenState) => void
  let composer: ComposerState | null = null
  let composerBody = ''
  let setBody: (next: string) => void
  const setActionError = vi.fn()

  function Probe() {
    const [screenState, setScreenState] = useState(state)
    const [currentComposer, setComposer] = useState(composer)
    const [currentBody, setComposerBody] = useState(composerBody)
    composer = currentComposer
    composerBody = currentBody
    setBody = setComposerBody
    state = screenState
    setState = setScreenState
    actions = useMobileDiffReviewCommentActions({
      client,
      connState: 'connected',
      worktreeId,
      screenState,
      currentItem: {
        filePath: 'src/a.ts',
        scope: 'unstaged',
        diffIdentity: 'diff-a'
      } as MobileDiffReviewQueueItem,
      queue: [],
      filteredQueue: [],
      filter: 'all',
      currentIndex: 0,
      composer: currentComposer,
      composerBody: currentBody,
      setScreenState,
      setCurrentIndex: vi.fn(),
      setComposer,
      setComposerBody,
      setActionError,
      setShowCompletion: vi.fn()
    })
    sendActions = useMobileDiffReviewSendActions({
      client,
      connState: 'connected',
      worktreeId,
      screenState,
      setActionError,
      setSendSheet: vi.fn(),
      saveCommentsAndReviewState: actions.saveCommentsAndReviewState,
      markSentComments: actions.markSentComments
    })
    return null
  }

  async function mount(sendRequest: RpcClient['sendRequest']) {
    client = { sendRequest } as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = ready([ORIGINAL])
    worktreeId = 'wt-a'
    composer = null
    composerBody = ''
    setActionError.mockReset()
  })

  it.each(['save', 'delete'] as const)(
    'preserves a newer composer after a delayed %s',
    async (operation) => {
      const response = deferred<unknown>()
      await mount(vi.fn(() => response.promise) as RpcClient['sendRequest'])
      act(() => actions.openEditComposer(ORIGINAL))
      let saving!: Promise<void>
      act(() => {
        saving = operation === 'save' ? actions.saveComposer() : actions.deleteComment()
      })
      if (operation === 'save') {
        act(() => setBody('changed while saving'))
        act(() => setBody(ORIGINAL.body))
      } else {
        act(() => {
          actions.closeComposer()
          actions.openEditComposer(SECOND)
        })
      }
      await act(async () => {
        response.resolve({ ok: true, result: {} })
        await saving
      })

      expect(composer?.mode).toBe('edit')
      expect(composerBody).toBe(operation === 'save' ? ORIGINAL.body : SECOND.body)
    }
  )

  it('claims a pending composer synchronously so repeated Save creates one note', async () => {
    const response = deferred<unknown>()
    const sendRequest = vi.fn(() => response.promise)
    await mount(sendRequest as RpcClient['sendRequest'])
    act(() => actions.openComposer(3))
    act(() => setBody('new note'))
    let first!: Promise<void>
    let second!: Promise<void>
    let third!: Promise<void>
    act(() => {
      first = actions.saveComposer()
      second = actions.saveComposer()
    })
    act(() => {
      third = actions.saveComposer()
    })
    await act(async () => {
      response.resolve({ ok: true, result: {} })
      await Promise.all([first, second, third])
    })

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(state.kind === 'ready' && state.comments.map((comment) => comment.body)).toEqual([
      ORIGINAL.body,
      'new note'
    ])
    expect(composer).toBeNull()
  })

  it('does not roll back a newer successful save when an older save fails late', async () => {
    const firstResponse = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue({ ok: true, result: {} })
    await mount(sendRequest as RpcClient['sendRequest'])

    let first!: Promise<void>
    act(() => {
      first = actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)
    })
    const firstResult = first.catch(() => {})
    let second!: Promise<void>
    act(() => {
      second = actions.saveCommentsAndReviewState([ORIGINAL, SECOND, ADDED], REVIEW_STATE)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(state.kind === 'ready' && state.comments.map((comment) => comment.id)).toEqual([
      'one',
      'two',
      'three'
    ])

    await act(async () => {
      firstResponse.reject(new Error('old save failed'))
      await firstResult
      await second
    })
    expect(state.kind === 'ready' && state.comments.map((comment) => comment.id)).toEqual([
      'one',
      'two',
      'three'
    ])
  })

  it('rolls back consecutive failed writes to the last confirmed metadata', async () => {
    const firstResponse = deferred<unknown>()
    const secondResponse = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    await mount(sendRequest as RpcClient['sendRequest'])

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = actions
        .saveCommentsAndReviewState([ORIGINAL, SECOND], { ...REVIEW_STATE, completedAt: 10 })
        .catch(() => {})
    })
    act(() => {
      second = actions
        .saveCommentsAndReviewState([ORIGINAL, SECOND, ADDED], {
          ...REVIEW_STATE,
          completedAt: 20
        })
        .catch(() => {})
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstResponse.reject(new Error('first save failed'))
      await first
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await act(async () => {
      secondResponse.reject(new Error('second save failed'))
      await second
    })

    expect(state.kind === 'ready' && state.comments).toEqual([ORIGINAL])
    expect(state.kind === 'ready' && state.reviewState).toEqual(REVIEW_STATE)
    expect(setActionError).toHaveBeenLastCalledWith('second save failed')
  })

  it('retains the preceding successful write when the next queued write fails', async () => {
    const firstResponse = deferred<unknown>()
    const secondResponse = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    await mount(sendRequest as RpcClient['sendRequest'])

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)
    })
    act(() => {
      second = actions
        .saveCommentsAndReviewState([ORIGINAL, SECOND, ADDED], REVIEW_STATE)
        .catch(() => {})
    })
    await act(async () => {
      firstResponse.resolve({ ok: true, result: {} })
      await first
    })
    await act(async () => {
      secondResponse.reject(new Error('second save failed'))
      await second
    })

    expect(state.kind === 'ready' && state.comments).toEqual([ORIGINAL, SECOND])
  })

  it('keeps an external refresh as the baseline when an older write completes later', async () => {
    const firstResponse = deferred<unknown>()
    const secondResponse = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    await mount(sendRequest as RpcClient['sendRequest'])

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    act(() => setState(ready([ORIGINAL, ADDED])))
    act(() => {
      second = actions
        .saveCommentsAndReviewState([ORIGINAL, ADDED, SECOND], REVIEW_STATE)
        .catch(() => {})
    })
    await act(async () => {
      firstResponse.resolve({ ok: true, result: {} })
      await first
    })
    await act(async () => {
      secondResponse.reject(new Error('second save failed'))
      await second
    })

    expect(state.kind === 'ready' && state.comments).toEqual([ORIGINAL, ADDED])
  })

  it('confirms a queued write that starts after an external refresh', async () => {
    const firstResponse = deferred<unknown>()
    const secondResponse = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
      .mockRejectedValue(new Error('last save failed'))
    await mount(sendRequest as RpcClient['sendRequest'])

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE).catch(() => {})
    })
    act(() => {
      second = actions.saveCommentsAndReviewState([ORIGINAL, SECOND, ADDED], REVIEW_STATE)
    })
    await act(async () => {
      await Promise.resolve()
    })
    act(() => setState(ready([ORIGINAL, ADDED])))
    await act(async () => {
      firstResponse.reject(new Error('first save failed'))
      await first
    })
    await act(async () => {
      secondResponse.resolve({ ok: true, result: {} })
      await second
    })
    await act(async () => {
      await actions.saveCommentsAndReviewState([ORIGINAL], REVIEW_STATE).catch(() => {})
    })

    expect(state.kind === 'ready' && state.comments).toEqual([ORIGINAL, SECOND, ADDED])
  })

  it('does not let an old client failure replace a newer worktree screen', async () => {
    const firstResponse = deferred<unknown>()
    const sendRequest = vi.fn(() => firstResponse.promise)
    await mount(sendRequest as RpcClient['sendRequest'])
    let pending!: Promise<void>
    act(() => {
      pending = actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)
    })
    const pendingResult = pending.catch(() => {})
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)

    worktreeId = 'wt-b'
    client = { sendRequest: vi.fn() } as unknown as RpcClient
    act(() => {
      renderer?.update(createElement(Probe))
      setState(ready([{ ...ADDED, worktreeId: 'wt-b' }]))
    })
    await act(async () => {
      firstResponse.reject(new Error('old client failed'))
      await pendingResult
    })
    expect(state.kind === 'ready' && state.comments.map((comment) => comment.id)).toEqual(['three'])
  })

  it('does not let an old callback save after switching away and back to its worktree', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: {} })
    await mount(sendRequest as RpcClient['sendRequest'])
    const oldActions = actions

    worktreeId = 'wt-b'
    act(() => renderer?.update(createElement(Probe)))
    worktreeId = 'wt-a'
    act(() => renderer?.update(createElement(Probe)))
    await act(async () => {
      await oldActions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)
    })

    expect(sendRequest).not.toHaveBeenCalled()
    expect(state.kind === 'ready' && state.comments.map((comment) => comment.id)).toEqual(['one'])
  })

  it('does not save the previous worktree snapshot before the new review loads', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: {} })
    await mount(sendRequest as RpcClient['sendRequest'])

    worktreeId = 'wt-b'
    act(() => renderer?.update(createElement(Probe)))
    await act(async () => {
      expect(await actions.saveCommentsAndReviewState([ORIGINAL, SECOND], REVIEW_STATE)).toBe(false)
    })

    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('preserves new and edited notes while marking only unchanged notes after a delayed send', async () => {
    state = ready([ORIGINAL, SECOND])
    const sendResponse = deferred<unknown>()
    const sendRequest = vi.fn((method: string) =>
      method === 'terminal.send' ? sendResponse.promise : Promise.resolve({ ok: true, result: {} })
    )
    await mount(sendRequest as RpcClient['sendRequest'])

    let sending!: Promise<void>
    act(() => {
      sending = sendActions.sendPromptToTerminal('terminal-a', [ORIGINAL, SECOND])
    })
    await act(async () => {
      await actions.saveCommentsAndReviewState(
        [{ ...ORIGINAL, body: 'edited while sending', updatedAt: 2 }, SECOND, ADDED],
        REVIEW_STATE
      )
    })
    await act(async () => {
      sendResponse.resolve({ ok: true, result: { send: { accepted: true } } })
      await sending
    })

    expect(state.kind).toBe('ready')
    if (state.kind !== 'ready') {
      return
    }
    expect(state.comments.map((comment) => comment.id)).toEqual(['one', 'two', 'three'])
    expect(state.comments[0]?.body).toBe('edited while sending')
    expect(state.comments[0]?.sentAt).toBeUndefined()
    expect(state.comments[1]?.sentAt).toEqual(expect.any(Number))
    expect(state.comments[2]?.sentAt).toBeUndefined()
    const writes = sendRequest.mock.calls.filter(([method]) => method === 'worktree.set')
    expect(writes.at(-1)?.[1]).toMatchObject({ diffComments: state.comments })
  })

  it('leaves a note unsent when it was edited back to the same body during delivery', async () => {
    const sendResponse = deferred<unknown>()
    const sendRequest = vi.fn((method: string) =>
      method === 'terminal.send' ? sendResponse.promise : Promise.resolve({ ok: true, result: {} })
    )
    await mount(sendRequest as RpcClient['sendRequest'])

    let sending!: Promise<void>
    act(() => {
      sending = sendActions.sendPromptToTerminal('terminal-a', [ORIGINAL])
    })
    await act(async () => {
      await actions.saveCommentsAndReviewState([{ ...ORIGINAL, updatedAt: 2 }], REVIEW_STATE)
    })
    await act(async () => {
      sendResponse.resolve({ ok: true, result: { send: { accepted: true } } })
      await sending
    })

    expect(state.kind === 'ready' && state.comments[0]).toMatchObject({
      body: 'original',
      updatedAt: 2
    })
    expect(state.kind === 'ready' && state.comments[0]?.sentAt).toBeUndefined()
    expect(sendRequest.mock.calls.filter(([method]) => method === 'worktree.set')).toHaveLength(1)
  })

  it.each<Partial<DiffComment>>([
    { filePath: 'moved.ts' },
    { lineNumber: 5, startLine: 3 },
    { source: 'markdown', selectedText: 'new selection' },
    { scope: 'branch', diffIdentity: 'new-diff' },
    { oldPath: 'previous.ts' },
    { createdAt: 2 }
  ])('does not mark changed comment context sent after a reload: %j', async (changed) => {
    const sendResponse = deferred<unknown>()
    const sendRequest = vi.fn((method: string) =>
      method === 'terminal.send' ? sendResponse.promise : Promise.resolve({ ok: true, result: {} })
    )
    await mount(sendRequest as RpcClient['sendRequest'])
    let sending!: Promise<void>
    await act(async () => {
      sending = sendActions.sendPromptToTerminal('terminal-a', [ORIGINAL])
    })
    act(() => setState(ready([{ ...ORIGINAL, ...changed }])))
    await act(async () => {
      sendResponse.resolve({ ok: true, result: { send: { accepted: true } } })
      await sending
    })
    expect(state.kind === 'ready' && state.comments[0]?.sentAt).toBeUndefined()
    expect(sendRequest.mock.calls.filter(([method]) => method === 'worktree.set')).toHaveLength(0)
  })
})
