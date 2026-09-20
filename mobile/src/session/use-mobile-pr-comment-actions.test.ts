import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PRComment } from '../../../src/shared/github/comment-types'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { GitHubPrMutationOutcome } from './github-pr-mutations'
import {
  useMobilePrCommentActions,
  type PrCommentActionsInput,
  type PrCommentMutations
} from './use-mobile-pr-comment-actions'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function comment(id: number): PRComment {
  return {
    id,
    author: 'octocat',
    authorAvatarUrl: '',
    body: 'hi',
    createdAt: 'now',
    url: 'u'
  }
}

describe('PR comment action ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let latest!: ReturnType<typeof useMobilePrCommentActions>
  let input: PrCommentActionsInput
  let mutations: PrCommentMutations
  let addRootComment: ReturnType<typeof vi.fn>
  let refetch: ReturnType<typeof vi.fn>

  function Harness(props: PrCommentActionsInput) {
    latest = useMobilePrCommentActions(props)
    return null
  }
  async function render(next = input) {
    input = next
    await act(async () => {
      const element = createElement(Harness, input)
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    addRootComment = vi.fn().mockResolvedValue({ ok: true })
    refetch = vi.fn()
    mutations = {
      reply: vi.fn().mockResolvedValue({ ok: true }),
      resolveThread: vi.fn().mockResolvedValue({ ok: true }),
      addRootComment,
      editComment: vi.fn().mockResolvedValue({ ok: true }),
      deleteComment: vi.fn().mockResolvedValue({ ok: true })
    }
    input = {
      client: { sendRequest: vi.fn() } as unknown as RpcClient,
      connState: 'connected',
      worktreeId: 'A',
      prNumber: 7,
      prRepo: { owner: 'Orca', repo: 'Client' },
      refetch,
      mutations
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['client', 'worktree', 'PR', 'repo', 'disconnect', 'unmount'])(
    'does not publish a completed %s source mutation into its replacement',
    async (change) => {
      const pending = deferred<GitHubPrMutationOutcome>()
      addRootComment.mockReturnValueOnce(pending.promise)
      await render()
      let first!: Promise<boolean>
      act(() => {
        first = latest.addRootComment('Old comment')
      })
      if (change === 'unmount') {
        act(() => renderer?.unmount())
        renderer = null
      } else {
        await render({
          ...input,
          ...(change === 'client'
            ? { client: { sendRequest: vi.fn() } as unknown as RpcClient }
            : {}),
          ...(change === 'worktree' ? { worktreeId: 'B' } : {}),
          ...(change === 'PR' ? { prNumber: 8 } : {}),
          ...(change === 'repo'
            ? { prRepo: { ...input.prRepo!, host: 'github.enterprise.test' } }
            : {}),
          ...(change === 'disconnect' ? { connState: 'disconnected' as const } : {})
        })
        expect(latest.isRootBusy).toBe(false)
      }
      await act(async () => {
        pending.resolve({ ok: true })
        await first
      })
      expect(await first).toBe(false)
      expect(refetch).not.toHaveBeenCalled()
      expect(triggerSuccess).not.toHaveBeenCalled()
    }
  )

  it('lets a new PR submit while an old root comment is pending and isolates the old failure', async () => {
    const old = deferred<GitHubPrMutationOutcome>()
    const current = deferred<GitHubPrMutationOutcome>()
    addRootComment.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await render()
    let oldSave!: Promise<boolean>
    let currentSave!: Promise<boolean>
    act(() => {
      oldSave = latest.addRootComment('A')
    })
    await render({ ...input, prNumber: 8 })
    act(() => {
      currentSave = latest.addRootComment('B')
    })
    expect(addRootComment).toHaveBeenCalledTimes(2)
    expect(addRootComment).toHaveBeenNthCalledWith(2, {
      prNumber: 8,
      body: 'B',
      prRepo: input.prRepo
    })
    await act(async () => {
      old.resolve({ ok: false, error: 'Old failure' })
      await oldSave
    })
    expect(await oldSave).toBe(false)
    expect(latest.error).toBeNull()
    expect(latest.isRootBusy).toBe(true)
    expect(triggerError).not.toHaveBeenCalled()
    await act(async () => {
      current.resolve({ ok: true })
      await currentSave
    })
    expect(await currentSave).toBe(true)
    expect(latest.isRootBusy).toBe(false)
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('blocks a duplicate after A to B to A while letting the old completion expire', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    addRootComment.mockReturnValueOnce(pending.promise)
    await render()
    let first!: Promise<boolean>
    act(() => {
      first = latest.addRootComment('A')
    })
    await render({ ...input, prNumber: 8 })
    await render({ ...input, prNumber: 7 })
    expect(latest.isRootBusy).toBe(true)
    expect(await latest.addRootComment('Duplicate A')).toBe(false)
    expect(addRootComment).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ ok: true })
      await first
    })
    expect(await first).toBe(false)
    expect(latest.isRootBusy).toBe(false)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('rejects a stale callback captured for another PR', async () => {
    await render()
    const staleAdd = latest.addRootComment
    await render({ ...input, prNumber: 8 })
    expect(await staleAdd('Stale comment')).toBe(false)
    expect(addRootComment).not.toHaveBeenCalled()
  })

  it('keeps the pending source through a canonical github.com repo refresh', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    addRootComment.mockReturnValueOnce(pending.promise)
    await render()
    let save!: Promise<boolean>
    act(() => {
      save = latest.addRootComment('Comment')
    })
    await render({ ...input, prRepo: { host: 'github.com', owner: 'orca', repo: 'client' } })
    expect(latest.isRootBusy).toBe(true)
    await act(async () => {
      pending.resolve({ ok: true })
      await save
    })
    expect(await save).toBe(true)
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps each comment busy independently and blocks a same-comment double tap', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    const reply = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true })
    await render({ ...input, mutations: { ...mutations, reply } })
    let first!: Promise<boolean>
    act(() => {
      first = latest.reply(comment(42), 'First')
    })
    expect(latest.isReplyBusy(42)).toBe(true)
    expect(latest.isReplyBusy(43)).toBe(false)
    expect(await latest.reply(comment(42), 'Duplicate')).toBe(false)
    let second!: Promise<boolean>
    act(() => {
      second = latest.reply(comment(43), 'Second')
    })
    await act(async () => second)
    expect(reply).toHaveBeenCalledTimes(2)
    expect(latest.isReplyBusy(42)).toBe(true)
    await act(async () => {
      pending.resolve({ ok: true })
      await first
    })
    expect(latest.isReplyBusy(42)).toBe(false)
  })

  it('does not report success when source changes during the authoritative refetch', async () => {
    const pendingRefetch = deferred<void>()
    refetch.mockReturnValue(pendingRefetch.promise)
    await render()
    let save!: Promise<boolean>
    act(() => {
      save = latest.addRootComment('Comment')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(refetch).toHaveBeenCalledOnce()
    await render({ ...input, prNumber: 8 })
    await act(async () => {
      pendingRefetch.resolve()
      await save
    })
    expect(await save).toBe(false)
    expect(triggerSuccess).not.toHaveBeenCalled()
  })

  it('does not let an old callback or a not-ready PR send a comment', async () => {
    await render({ ...input, prNumber: 0 })
    expect(latest.ready).toBe(false)
    let sent!: Promise<boolean>
    await act(async () => {
      sent = latest.addRootComment('No PR')
      await sent
    })
    expect(await sent).toBe(false)
    expect(addRootComment).not.toHaveBeenCalled()
  })
})
