import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { sendHostedTaskComment, sendLinearTaskComment } from './mobile-task-comment-rpc'
import { createMobileTaskDetailCommentAttempts } from './mobile-task-detail-comment-attempt'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const client = {} as RpcClient

describe('mobile task detail comment ownership', () => {
  it.each(['github', 'gitlab', 'linear'] as const)(
    'keeps %s issue B free of issue A comment after an awaited response',
    async (provider) => {
      const attempts = createMobileTaskDetailCommentAttempts()
      const request = deferred<unknown>()
      const sendRequest = vi.fn(() => request.promise)
      const rpcClient = { sendRequest } as unknown as RpcClient
      attempts.publish({ client: rpcClient, hostId: 'host-a', itemKey: `${provider}:issue-a` })
      const attempt = attempts.begin(rpcClient, 'host-a', `${provider}:issue-a`, provider)!
      let detail = { provider, comments: [] as Array<{ id: string; body: string }> }
      let draft = 'A comment'
      const submitted =
        provider === 'linear'
          ? sendLinearTaskComment(
              rpcClient,
              { id: 'issue-a', workspaceId: 'workspace-a' },
              'A comment'
            )
          : sendHostedTaskComment(
              rpcClient,
              { provider, source: { repoId: 'repo-a', number: 7, type: 'issue' } },
              'A comment'
            )
      const completion = submitted.then((comment) => {
        if (attempts.isCurrent(attempt)) {
          detail = {
            ...detail,
            comments: [...detail.comments, { id: String(comment.id), body: comment.body }]
          }
          draft = ''
        }
      })

      attempts.publish({ client: rpcClient, hostId: 'host-a', itemKey: `${provider}:issue-b` })
      draft = 'B draft'
      request.resolve({
        ok: true,
        result: { id: 'comment-on-a', comment: { id: 'comment-on-a', body: 'A comment' } }
      })
      await completion

      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(sendRequest.mock.calls[0]?.[1]).toMatchObject(
        provider === 'linear'
          ? { issueId: 'issue-a', workspaceId: 'workspace-a' }
          : { repo: 'id:repo-a', number: 7 }
      )
      expect(detail.comments).toEqual([])
      expect(draft).toBe('B draft')
    }
  )

  it('ignores a response after the same item is closed and reopened', () => {
    const attempts = createMobileTaskDetailCommentAttempts()
    attempts.publish({ client, hostId: 'host-a', itemKey: 'github:issue-a' })
    const old = attempts.begin(client, 'host-a', 'github:issue-a', 'github')!
    attempts.publish({ client, hostId: 'host-a', itemKey: null })
    attempts.publish({ client, hostId: 'host-a', itemKey: 'github:issue-a' })

    expect(attempts.isCurrent(old)).toBe(false)
  })

  it.each(['github', 'gitlab', 'linear'] as const)(
    'does not show an old %s status failure in a newly opened detail',
    async (provider) => {
      const attempts = createMobileTaskDetailCommentAttempts()
      const failure = deferred<unknown>()
      const sendRequest = vi.fn(() => failure.promise)
      const rpcClient = { sendRequest } as unknown as RpcClient
      attempts.publish({ client: rpcClient, hostId: 'host-a', itemKey: `${provider}:issue-a` })
      const view = attempts.capture(rpcClient, 'host-a')!
      let error: string | null = null
      const completion = rpcClient.sendRequest(`${provider}.updateIssue`).then((result) => {
        if (attempts.isCurrentView(view) && (result as { ok: boolean }).ok === false) {
          error = 'A status failed'
        }
      })

      attempts.publish({ client: rpcClient, hostId: 'host-a', itemKey: `${provider}:issue-b` })
      failure.resolve({ ok: false, error: { message: 'A status failed' } })
      await completion

      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(error).toBeNull()
    }
  )
})
