import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import { useMobileSessionDiffComments } from './use-mobile-session-diff-comments'

vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerSuccess: vi.fn()
}))

const NOTE: DiffComment = {
  id: 'host-note',
  worktreeId: 'wt-1',
  filePath: 'src/a.ts',
  lineNumber: 1,
  body: 'existing host note',
  createdAt: 1,
  side: 'modified'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve, reject }
}
function ok(result: unknown = {}): RpcResponse {
  return { id: 'request', ok: true, result, _meta: { runtimeId: 'host' } }
}
function metadata(comments: DiffComment[] = [NOTE]) {
  return ok({ worktree: { diffComments: comments } })
}

describe('session inline diff comments', () => {
  let renderer: ReactTestRenderer | undefined
  let actions: ReturnType<typeof useMobileSessionDiffComments>
  const showToast = vi.fn()
  const snapshots: Array<{ bodies: string[]; busy: boolean }> = []
  function Probe({
    client,
    worktreeId = 'wt-1',
    connState = 'connected'
  }: {
    client: RpcClient
    worktreeId?: string
    connState?: ConnectionState
  }) {
    actions = useMobileSessionDiffComments({
      client,
      connState,
      worktreeId,
      enabled: true,
      showToast
    })
    snapshots.push({ bodies: actions.comments.map((note) => note.body), busy: actions.busy })
    return null
  }
  afterEach(async () => {
    await act(async () => renderer?.unmount())
    showToast.mockClear()
    snapshots.length = 0
  })

  it('cannot replace existing host notes before the first metadata read finishes', async () => {
    const initial = deferred<RpcResponse>()
    let server = [NOTE]
    const sendRequest = vi.fn(async (method: string, params: { diffComments: DiffComment[] }) => {
      if (method === 'worktree.show') {
        return initial.promise
      }
      server = params.diffComments
      return ok()
    })
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    let added: boolean | undefined
    await act(async () => {
      added = await actions.add('src/a.ts', 2, 'new note B')
    })

    expect(added).toBe(false)
    expect(server).toEqual([NOTE])
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => initial.resolve(metadata()))
  })

  it('does not let an older metadata response erase a successfully saved note', async () => {
    const initial = deferred<RpcResponse>()
    let server = [NOTE]
    let reads = 0
    const sendRequest = vi.fn(async (method: string, params: { diffComments: DiffComment[] }) => {
      if (method === 'worktree.show') {
        return ++reads === 1 ? initial.promise : metadata(server)
      }
      server = params.diffComments
      return ok()
    })
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    await act(async () => actions.reload())
    await act(async () => {
      expect(await actions.add('src/a.ts', 2, 'new note B')).toBe(true)
    })
    await act(async () => initial.resolve(metadata()))

    expect(actions.comments.map((note) => note.body)).toEqual(['existing host note', 'new note B'])
    await act(async () => {
      await actions.add('src/a.ts', 3, 'new note C')
    })
    expect(server.map((note) => note.body)).toEqual([
      'existing host note',
      'new note B',
      'new note C'
    ])
  })

  it('reports a failed metadata read and allows an explicit retry before saving', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(metadata())
      .mockResolvedValue(ok())
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client }))
    })
    expect(actions.loadError).toBe('Offline')
    expect(actions.busy).toBe(true)
    await act(async () => {
      expect(await actions.add('src/a.ts', 2, 'blocked')).toBe(false)
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => actions.reload())
    expect(actions.loadError).toBeNull()
    await act(async () => {
      expect(await actions.add('src/a.ts', 2, 'saved')).toBe(true)
    })
    expect(sendRequest.mock.calls[2][1].diffComments.map((note: DiffComment) => note.body)).toEqual(
      ['existing host note', 'saved']
    )
  })

  it.each([
    null,
    {},
    { worktree: null },
    { worktree: 'bad' },
    { worktree: [] },
    { worktree: { diffComments: 'bad' } }
  ])('does not treat malformed metadata %j as a confirmed empty list', async (result) => {
    const sendRequest = vi.fn().mockResolvedValue(ok(result))
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    expect(actions.loadError).toBe('Invalid review notes response')
    await act(async () => {
      expect(await actions.add('src/a.ts', 2, 'blocked')).toBe(false)
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('accepts a real worktree object with no diffComments as empty', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(ok({ worktree: { id: 'wt-1' } }))
      .mockResolvedValue(ok())
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    await act(async () => {
      expect(await actions.add('src/a.ts', 2, 'saved')).toBe(true)
    })
    expect(sendRequest.mock.calls[1][1].diffComments).toHaveLength(1)
  })

  it('claims a write synchronously and restores the confirmed baseline after repeated failures', async () => {
    const first = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(new Error('Second save failed'))
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    let pending!: Promise<boolean>
    await act(async () => {
      pending = actions.add('src/a.ts', 2, 'first draft')
      expect(await actions.add('src/a.ts', 3, 'duplicate')).toBe(false)
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await act(async () => {
      first.reject(new Error('First save failed'))
      expect(await pending).toBe(false)
    })
    expect(actions.comments).toEqual([expect.objectContaining(NOTE)])
    await act(async () => {
      expect(await actions.add('src/a.ts', 3, 'second draft')).toBe(false)
    })
    expect(actions.comments).toEqual([expect.objectContaining(NOTE)])
    expect(actions.busy).toBe(false)
  })

  it.each([true, false])('queues delivery cleanup behind add (add success=%s)', async (success) => {
    const save = deferred<RpcResponse>()
    const cleanup = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
      .mockImplementationOnce(() => cleanup.promise)
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    let added!: Promise<boolean>, cleared!: Promise<void>
    const delivered = actions.comments
    await act(async () => {
      added = actions.add('src/a.ts', 2, 'new note')
      cleared = actions.clearDelivered(delivered)
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await act(async () => {
      if (success) {
        save.resolve(ok())
      } else {
        save.reject(new Error('Save failed'))
      }
      await added
    })
    expect(sendRequest.mock.calls[2][1].diffComments.map((note: DiffComment) => note.body)).toEqual(
      success ? ['new note'] : []
    )
    expect(actions.busy).toBe(true)
    await act(async () => {
      cleanup.resolve(ok())
      await cleared
    })
    expect(actions.comments.map((note) => note.body)).toEqual(success ? ['new note'] : [])
    expect(actions.busy).toBe(false)
  })

  it('preserves an edited-back note when an earlier delivery finishes', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(metadata([{ ...NOTE, updatedAt: 8 }]))
      .mockResolvedValue(ok())
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    const delivered = actions.comments
    await act(async () => actions.reload())
    await act(async () => actions.clearDelivered(delivered))
    expect(actions.comments).toEqual([expect.objectContaining({ ...NOTE, updatedAt: 8 })])
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('ignores an old client read and write failure after switching sources', async () => {
    const save = deferred<RpcResponse>()
    const staleRead = deferred<RpcResponse>()
    const oldSend = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
    const oldClient = { sendRequest: oldSend } as unknown as RpcClient
    const nextSend = vi
      .fn()
      .mockResolvedValue(metadata([{ ...NOTE, id: 'new-host', body: 'new source' }]))
    const nextClient = { sendRequest: nextSend } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client: oldClient }))
    })
    let stale!: Promise<void>, pending!: Promise<boolean>
    await act(async () => {
      stale = actions.reload()
    })
    await act(async () => actions.reload())
    await act(async () => {
      pending = actions.add('src/a.ts', 2, 'old draft')
    })
    const oldActions = actions
    await act(async () => {
      renderer?.update(createElement(Probe, { client: nextClient }))
    })
    await act(async () => {
      staleRead.resolve(metadata())
      save.reject(new Error('Old failure'))
      await stale
      await pending
      expect(await oldActions.add('src/a.ts', 3, 'stale callback')).toBe(false)
    })
    expect(actions.comments.map((note) => note.body)).toEqual(['new source'])
    expect(actions.busy).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('waits for an earlier visit write before reloading the same source after reconnect', async () => {
    const save = deferred<RpcResponse>()
    let server = [NOTE]
    const sendRequest = vi.fn(async (method: string, params: { diffComments: DiffComment[] }) => {
      if (method === 'worktree.show') {
        return metadata(server)
      }
      await save.promise
      server = params.diffComments
      return ok()
    })
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client }))
    })
    let pending!: Promise<boolean>
    await act(async () => {
      pending = actions.add('src/a.ts', 2, 'sent before disconnect')
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client, connState: 'disconnected' }))
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client }))
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(actions.busy).toBe(true)
    await act(async () => {
      save.resolve(ok())
      await pending
    })
    expect(sendRequest).toHaveBeenCalledTimes(3)
    expect(actions.comments.map((note) => note.body)).toEqual([
      'existing host note',
      'sent before disconnect'
    ])
    expect(actions.busy).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('rolls a failed delete back to the last confirmed list and releases busy', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce({
        id: 'request',
        ok: false,
        error: { code: 'failed', message: 'Delete failed' },
        _meta: { runtimeId: 'host' }
      })
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    await act(async () => actions.remove(NOTE.id))
    expect(sendRequest.mock.calls[1][1].diffComments).toEqual([])
    expect(actions.comments).toEqual([expect.objectContaining(NOTE)])
    expect(actions.busy).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Delete failed', 1600)
  })

  it('restores the latest successful addition if the queued delivery cleanup fails', async () => {
    const save = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
      .mockRejectedValueOnce(new Error('Cleanup failed'))
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    const delivered = actions.comments
    let adding!: Promise<boolean>, clearing!: Promise<void>
    await act(async () => {
      adding = actions.add('src/a.ts', 2, 'confirmed addition')
      clearing = actions.clearDelivered(delivered)
    })
    await act(async () => {
      save.resolve(ok())
      await adding
      await clearing
    })
    expect(actions.comments.map((note) => note.body)).toEqual([
      'existing host note',
      'confirmed addition'
    ])
    expect(actions.busy).toBe(false)
  })

  it('drops queued cleanup after unmount without extra writes or success notifications', async () => {
    const save = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
    await act(async () => {
      renderer = create(createElement(Probe, { client: { sendRequest } as unknown as RpcClient }))
    })
    const delivered = actions.comments
    let adding!: Promise<boolean>, clearing!: Promise<void>
    await act(async () => {
      adding = actions.add('src/a.ts', 2, 'addition')
      clearing = actions.clearDelivered(delivered)
    })
    await act(async () => renderer?.unmount())
    await act(async () => {
      save.resolve(ok())
      expect(await adding).toBe(false)
      await clearing
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('does not let an old worktree read replace the new worktree notes', async () => {
    const old = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(metadata([{ ...NOTE, worktreeId: 'wt-2', body: 'second worktree' }]))
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client }))
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client, worktreeId: 'wt-2' }))
    })
    await act(async () => old.resolve(metadata()))
    expect(actions.comments.map((note) => note.body)).toEqual(['second worktree'])
    expect(actions.busy).toBe(false)
  })

  it('recovers accepted delivery cleanup queued behind a write across same-client reconnect', async () => {
    const save = deferred<RpcResponse>()
    const cleanup = deferred<RpcResponse>()
    let server = [NOTE]
    let writes = 0
    const sendRequest = vi.fn(async (method: string, params: { diffComments: DiffComment[] }) => {
      if (method === 'worktree.show') {
        return metadata(server)
      }
      writes += 1
      await (writes === 1 ? save.promise : cleanup.promise)
      server = params.diffComments
      return ok()
    })
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client }))
    })
    const delivered = actions.comments
    let adding!: Promise<boolean>, clearing!: Promise<void>
    await act(async () => {
      adding = actions.add('src/a.ts', 2, 'not delivered')
      clearing = actions.clearDelivered(delivered)
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client, connState: 'disconnected' }))
    })
    const afterDisconnect = snapshots.length
    await act(async () => {
      renderer?.update(createElement(Probe, { client }))
    })
    await act(async () => {
      save.resolve(ok())
      await adding
      await clearing
    })
    expect(actions.busy).toBe(true)
    expect(snapshots.slice(afterDisconnect).every((snapshot) => snapshot.busy)).toBe(true)
    await act(async () => cleanup.resolve(ok()))
    expect(server.map((note) => note.body)).toEqual(['not delivered'])
    expect(actions.comments.map((note) => note.body)).toEqual(['not delivered'])
    expect(actions.busy).toBe(false)
  })

  it('keeps a newer note version found while recovering pending delivery cleanup', async () => {
    const save = deferred<RpcResponse>()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
      .mockResolvedValueOnce(metadata([{ ...NOTE, updatedAt: 9 }]))
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client }))
    })
    const delivered = actions.comments
    let adding!: Promise<boolean>, clearing!: Promise<void>
    await act(async () => {
      adding = actions.add('src/a.ts', 2, 'draft')
      clearing = actions.clearDelivered(delivered)
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client, connState: 'disconnected' }))
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client }))
    })
    await act(async () => {
      save.resolve(ok())
      await adding
      await clearing
    })
    expect(actions.comments).toEqual([expect.objectContaining({ ...NOTE, updatedAt: 9 })])
    expect(actions.busy).toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })

  it('never applies queued delivery cleanup to a replacement client with the same worktree id', async () => {
    const save = deferred<RpcResponse>()
    const firstSend = vi
      .fn()
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => save.promise)
    const nextSend = vi.fn().mockResolvedValue(metadata())
    const first = { sendRequest: firstSend } as unknown as RpcClient
    const next = { sendRequest: nextSend } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Probe, { client: first }))
    })
    const delivered = actions.comments
    let adding!: Promise<boolean>, clearing!: Promise<void>
    await act(async () => {
      adding = actions.add('src/a.ts', 2, 'draft')
      clearing = actions.clearDelivered(delivered)
    })
    await act(async () => {
      renderer?.update(createElement(Probe, { client: next }))
    })
    await act(async () => {
      save.resolve(ok())
      await adding
      await clearing
    })
    expect(actions.comments).toEqual([expect.objectContaining(NOTE)])
    expect(actions.busy).toBe(false)
    expect(nextSend).toHaveBeenCalledTimes(1)
    expect(firstSend).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'handles a late accepted delivery only for its original client (replaced=%s)',
    async (replaced) => {
      const sendRequest = vi.fn(async (method: string) =>
        method === 'worktree.show' ? metadata() : ok()
      )
      const client = { sendRequest } as unknown as RpcClient
      await act(async () => {
        renderer = create(createElement(Probe, { client }))
      })
      const clear = actions.clearDelivered
      const delivered = actions.comments
      await act(async () => {
        renderer?.update(createElement(Probe, { client, connState: 'disconnected' }))
      })
      await act(async () => {
        renderer?.update(
          createElement(Probe, {
            client: replaced ? ({ sendRequest } as unknown as RpcClient) : client
          })
        )
      })
      await act(async () => clear(delivered))
      expect(actions.comments).toHaveLength(replaced ? 1 : 0)
      expect(sendRequest.mock.calls.filter(([method]) => method === 'worktree.set')).toHaveLength(
        replaced ? 0 : 1
      )
      expect(actions.busy).toBe(false)
    }
  )
})
