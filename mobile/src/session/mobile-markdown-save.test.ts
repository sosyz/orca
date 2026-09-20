import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import type { MarkdownDocState } from './mobile-session-route-types'
import {
  acknowledgeMobileMarkdownSaveCommits,
  saveMobileMarkdownDocument,
  type MarkdownSaveRequest
} from './mobile-markdown-save'

const draft: Extract<MarkdownDocState, { status: 'ready' }> = {
  status: 'ready',
  content: 'original',
  localContent: 'phone draft',
  baseVersion: 'v1',
  editable: true,
  isDirty: true
}

function deferred() {
  let resolve!: (response: RpcResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RpcResponse>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function saved(content = 'phone draft'): RpcResponse {
  return {
    id: '1',
    ok: true,
    result: { content, version: 'v2', isDirty: false },
    _meta: { runtimeId: 'host' }
  }
}

function setup() {
  let docs = new Map<string, MarkdownDocState>([['md', { ...draft }]])
  let scope = 0
  const requests = new Map<string, MarkdownSaveRequest>()
  const sendRequest = vi.fn<(...args: unknown[]) => Promise<RpcResponse>>()
  const onSaved = vi.fn()
  const onError = vi.fn()
  const invalidateReads = vi.fn()
  const queued: Array<(prev: Map<string, MarkdownDocState>) => Map<string, MarkdownDocState>> = []
  let deferUpdates = false
  return {
    requests,
    sendRequest,
    onSaved,
    onError,
    invalidateReads,
    doc: () => docs.get('md'),
    edit: (content: string) => {
      docs.set('md', { ...draft, localContent: content, saving: true })
    },
    close: () => {
      requests.delete('md')
      docs.delete('md')
    },
    switchScope: () => {
      scope += 1
      requests.clear()
      docs = new Map([['md', { ...draft, localContent: 'other workspace' }]])
    },
    defer: () => {
      deferUpdates = true
    },
    commit: () => acknowledgeMobileMarkdownSaveCommits(requests, docs),
    flush: () => {
      for (const update of queued.splice(0)) {
        docs = update(docs)
      }
      acknowledgeMobileMarkdownSaveCommits(requests, docs)
    },
    save: async () => {
      const requestScope = scope
      await saveMobileMarkdownDocument({
        client: { sendRequest },
        current: docs.get('md'),
        tabId: 'md',
        worktreeId: 'workspace',
        requests,
        isCurrentScope: () => scope === requestScope,
        invalidateReads,
        updateDocs: (update) => {
          if (deferUpdates) {
            queued.push(update)
          } else {
            docs = update(docs)
          }
        },
        onSaved,
        onError
      })
      if (!deferUpdates) {
        acknowledgeMobileMarkdownSaveCommits(requests, docs)
      }
    }
  }
}

describe('mobile markdown save ownership', () => {
  it('deduplicates taps and commits the acknowledged content/version', async () => {
    const state = setup()
    const response = deferred()
    state.sendRequest.mockReturnValue(response.promise)
    const pending = state.save()
    await state.save()
    expect(state.sendRequest).toHaveBeenCalledTimes(1)
    expect(state.sendRequest).toHaveBeenCalledWith('markdown.saveTab', {
      worktree: 'id:workspace',
      tabId: 'md',
      content: 'phone draft',
      baseVersion: 'v1'
    })
    response.resolve(saved())
    await pending
    expect(state.doc()).toMatchObject({
      content: 'phone draft',
      localContent: 'phone draft',
      baseVersion: 'v2',
      isDirty: false,
      saving: false,
      refreshing: false
    })
    expect(state.invalidateReads).toHaveBeenCalledTimes(2)
    expect(state.onSaved).toHaveBeenCalledOnce()
  })

  it('preserves input delivered by the editor while the save is pending', async () => {
    const state = setup()
    const response = deferred()
    state.sendRequest.mockReturnValue(response.promise)
    const pending = state.save()
    state.edit('newer phone draft')
    response.resolve(saved())
    await pending
    expect(state.doc()).toMatchObject({
      content: 'phone draft',
      localContent: 'newer phone draft',
      baseVersion: 'v2',
      isDirty: true
    })
  })

  it.each(['success', 'failure'] as const)(
    'ignores a stale %s after a workspace switch',
    async (outcome) => {
      const state = setup()
      const oldResponse = deferred()
      const newResponse = deferred()
      state.sendRequest
        .mockReturnValueOnce(oldResponse.promise)
        .mockReturnValueOnce(newResponse.promise)
      const oldSave = state.save()
      state.switchScope()
      const newSave = state.save()
      if (outcome === 'success') {
        oldResponse.resolve(saved())
      } else {
        oldResponse.reject(new Error('old host failed'))
      }
      await oldSave
      expect(state.doc()).toMatchObject({ localContent: 'other workspace', saving: true })
      expect(state.requests.get('md')?.pending).toBe(true)
      expect(state.onSaved).not.toHaveBeenCalled()
      expect(state.onError).not.toHaveBeenCalled()
      newResponse.resolve(saved('other workspace'))
      await newSave
      expect(state.doc()).toMatchObject({ content: 'other workspace', saving: false })
    }
  )

  it('does not recreate a closed document when the host acknowledges its save', async () => {
    const state = setup()
    const response = deferred()
    state.sendRequest.mockReturnValue(response.promise)
    const pending = state.save()
    state.close()
    response.resolve(saved())
    await pending
    expect(state.doc()).toBeUndefined()
    expect(state.onSaved).not.toHaveBeenCalled()
  })

  it('keeps the dirty draft retryable after a host conflict', async () => {
    const state = setup()
    state.sendRequest.mockResolvedValueOnce({
      id: '1',
      ok: false,
      error: { code: 'conflict', message: 'conflict' },
      _meta: { runtimeId: 'host' }
    })
    await state.save()
    expect(state.doc()).toMatchObject({
      localContent: 'phone draft',
      isDirty: true,
      saving: false,
      saveError: 'conflict'
    })
    state.sendRequest.mockResolvedValueOnce(saved())
    await state.save()
    expect(state.onError).toHaveBeenCalledOnce()
    expect(state.onSaved).toHaveBeenCalledOnce()
    expect(state.doc()).toMatchObject({ isDirty: false, saveError: undefined })
  })

  it('applies React-batched state updates after the request finishes', async () => {
    const state = setup()
    state.defer()
    state.sendRequest.mockResolvedValue(saved())
    await state.save()
    state.flush()
    expect(state.doc()).toMatchObject({ content: 'phone draft', saving: false, isDirty: false })
  })

  it('waits for the successful state update before saving a newer edit', async () => {
    const state = setup()
    const firstResponse = deferred()
    state.defer()
    state.sendRequest.mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce({
      id: 2,
      ok: true,
      result: { content: 'newer phone draft', version: 'v3', isDirty: false }
    })

    const firstSave = state.save()
    firstResponse.resolve(saved())
    await firstSave
    state.edit('newer phone draft')
    state.commit()
    await state.save()
    expect(state.sendRequest).toHaveBeenCalledTimes(1)
    expect(state.requests.get('md')?.pending).toBe(true)

    state.flush()
    expect(state.requests.get('md')?.pending).toBe(false)
    expect(state.doc()).toMatchObject({
      content: 'phone draft',
      localContent: 'newer phone draft',
      baseVersion: 'v2',
      saving: false,
      isDirty: true
    })

    const secondSave = state.save()
    expect(state.sendRequest).toHaveBeenNthCalledWith(2, 'markdown.saveTab', {
      worktree: 'id:workspace',
      tabId: 'md',
      content: 'newer phone draft',
      baseVersion: 'v2'
    })
    await secondSave
    state.flush()
    expect(state.doc()).toMatchObject({
      content: 'newer phone draft',
      baseVersion: 'v3',
      isDirty: false
    })
  })

  it('waits for a failed state update before retrying the dirty draft', async () => {
    const state = setup()
    state.defer()
    state.sendRequest
      .mockResolvedValueOnce({
        id: '1',
        ok: false,
        error: { code: 'conflict', message: 'conflict' },
        _meta: { runtimeId: 'host' }
      })
      .mockResolvedValueOnce(saved())

    await state.save()
    state.commit()
    await state.save()
    expect(state.sendRequest).toHaveBeenCalledTimes(1)
    expect(state.requests.get('md')?.pending).toBe(true)

    state.flush()
    expect(state.doc()).toMatchObject({ saveError: 'conflict', saving: false, isDirty: true })
    expect(state.requests.get('md')?.pending).toBe(false)

    const retry = state.save()
    expect(state.sendRequest).toHaveBeenNthCalledWith(2, 'markdown.saveTab', {
      worktree: 'id:workspace',
      tabId: 'md',
      content: 'phone draft',
      baseVersion: 'v1'
    })
    await retry
    state.flush()
    expect(state.doc()).toMatchObject({ content: 'phone draft', baseVersion: 'v2' })
  })

  it('rejects an already queued state update after switching scope', async () => {
    const state = setup()
    state.defer()
    state.sendRequest.mockResolvedValue(saved())
    await state.save()
    state.switchScope()
    state.flush()
    expect(state.doc()).toMatchObject({ localContent: 'other workspace', content: 'original' })
  })
})
