import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createMobileTaskDetailCommentAttempts } from './mobile-task-detail-comment-attempt'
import {
  requestGitHubTaskStatus,
  requestGitLabTaskStatus
} from './mobile-task-hosted-status-request'
import { createMobileTaskListLoadOwnership } from './mobile-task-list-load-ownership'
import { closeTaskItemOnOwnedStatusResult } from './mobile-task-status-result'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('mobile task status completion', () => {
  it('preserves hosted provider request targets and status values', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: {} })
    const client = { sendRequest } as unknown as RpcClient
    await requestGitHubTaskStatus(client, {
      repoId: 'gh-repo',
      number: 7,
      type: 'issue',
      state: 'open'
    })
    await requestGitHubTaskStatus(client, {
      repoId: 'gh-repo',
      number: 8,
      type: 'pr',
      state: 'closed'
    })
    await requestGitLabTaskStatus(client, {
      repoId: 'gl-repo',
      number: 9,
      type: 'issue',
      state: 'opened',
      projectRef: { host: 'gitlab.example', path: 'team/project' }
    })
    await requestGitLabTaskStatus(client, {
      repoId: 'gl-repo',
      number: 10,
      type: 'mr',
      state: 'closed',
      projectRef: { host: 'gitlab.example', path: 'team/project' }
    })

    expect(sendRequest.mock.calls).toEqual([
      ['github.updateIssue', { repo: 'id:gh-repo', number: 7, updates: { state: 'closed' } }],
      ['github.updatePRState', { repo: 'id:gh-repo', prNumber: 8, updates: { state: 'open' } }],
      [
        'gitlab.updateIssue',
        {
          repo: 'id:gl-repo',
          number: 9,
          updates: { state: 'closed' },
          projectRef: { host: 'gitlab.example', path: 'team/project' }
        }
      ],
      [
        'gitlab.updateMRState',
        {
          repo: 'id:gl-repo',
          iid: 10,
          state: 'opened',
          projectRef: { host: 'gitlab.example', path: 'team/project' }
        }
      ]
    ])
  })

  it('keeps B detail and status picker when A status RPC acknowledges late', async () => {
    const owner = createMobileTaskListLoadOwnership()
    const load = () => {}
    const acknowledged = deferred<void>()
    const itemA = { key: 'linear:issue-a' }
    const itemB = { key: 'linear:issue-b' }
    let detail: typeof itemA | null = itemA
    let picker: typeof itemA | null = itemA
    owner.publish(load)
    const completion = acknowledged.promise.then(() => {
      detail = closeTaskItemOnOwnedStatusResult(detail, itemA.key, owner.owns(load))
      picker = closeTaskItemOnOwnedStatusResult(picker, itemA.key, owner.owns(load))
    })

    detail = itemB
    picker = itemB
    acknowledged.resolve()
    await completion
    expect(detail).toBe(itemB)
    expect(picker).toBe(itemB)
  })

  it('does not close a reused key after the list source changes', () => {
    const owner = createMobileTaskListLoadOwnership()
    const oldLoad = () => {}
    const newLoad = () => {}
    const item = { key: 'github:issue-a' }
    owner.publish(oldLoad)
    owner.invalidate(oldLoad)
    owner.publish(newLoad)
    expect(closeTaskItemOnOwnedStatusResult(item, item.key, owner.owns(oldLoad))).toBe(item)
    expect(closeTaskItemOnOwnedStatusResult(item, item.key, owner.owns(newLoad))).toBeNull()
  })

  it.each(['github', 'gitlab', 'linear'] as const)(
    'keeps a newly reopened %s A detail after an old A status succeeds',
    async (provider) => {
      const owner = createMobileTaskListLoadOwnership()
      const views = createMobileTaskDetailCommentAttempts()
      const client = {} as RpcClient
      const load = () => {}
      const item = { key: `${provider}:issue-a` }
      const acknowledged = deferred<void>()
      let detail: typeof item | null = item
      owner.publish(load)
      views.publish({ client, hostId: 'host-a', itemKey: item.key })
      const originalView = views.capture(client, 'host-a')
      const completion = acknowledged.promise.then(() => {
        detail = closeTaskItemOnOwnedStatusResult(
          detail,
          item.key,
          owner.owns(load) && views.isCurrentView(originalView)
        )
      })

      views.publish({ client, hostId: 'host-a', itemKey: 'other-item' })
      views.publish({ client, hostId: 'host-a', itemKey: item.key })
      const reopened = { ...item }
      detail = reopened
      acknowledged.resolve()
      await completion

      expect(detail).toBe(reopened)
    }
  )
})
