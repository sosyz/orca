import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileMarkdownNoteCreation } from './use-mobile-markdown-note-creation'

type Response = { ok: true; result: unknown } | { ok: false; error: { message: string } }
const success = (result: unknown = {}): Response => ({ ok: true, result })
const supported = success({ capabilities: [FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY] })
const noop = () => {}

function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function clientWithResponses(
  responder: (method: string, params: unknown) => Promise<Response> | Response
) {
  const sendRequest = vi.fn(responder)
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

type HarnessProps = {
  client: RpcClient
  connState?: ConnectionState
  hostId?: string
  worktreeId?: string
  onFetch?: () => void
  onSchedule?: (callback: () => void, ms: number) => void
  onToast?: (message: string) => void
}

let current: {
  create: () => Promise<void>
  creating: boolean
  error: string
}
let renderer: ReactTestRenderer | null = null

function Harness({
  client,
  connState = 'connected',
  hostId = 'host-a',
  worktreeId = 'worktree-a',
  onFetch = noop,
  onSchedule = noop,
  onToast = noop
}: HarnessProps) {
  const [error, setError] = useState('')
  const { creatingMarkdown, createMarkdownNote } = useMobileMarkdownNoteCreation({
    client,
    connState,
    hostId,
    worktreeId,
    fetchSessionTabs: onFetch,
    scheduleDelayedAction: onSchedule,
    setCreateError: setError,
    showToast: onToast
  })
  current = { create: createMarkdownNote, creating: creatingMarkdown, error }
  return null
}

async function render(props: HarnessProps) {
  await act(async () => {
    const element = createElement(Harness, props)
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('mobile Markdown note creation owner', () => {
  it('retires an old preflight across disconnect and reconnect of the same client', async () => {
    const status = deferred()
    let statusCount = 0
    const { client, sendRequest } = clientWithResponses((method) => {
      if (method === 'status.get') {
        return statusCount++ === 0 ? status.promise : supported
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      return success()
    })
    await render({ client })
    let old!: Promise<void>
    act(() => {
      old = current.create()
    })
    await render({ client, connState: 'disconnected' })
    await render({ client })
    await act(async () => {
      status.resolve(supported)
      await old
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
    await act(async () => current.create())
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'status.get',
      'status.get',
      'worktree.show',
      'files.createFile',
      'files.open'
    ])
  })

  it('claims synchronously so a batched double tap creates one note', async () => {
    const status = deferred()
    const { client, sendRequest } = clientWithResponses((method) => {
      if (method === 'status.get') {
        return status.promise
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      return success()
    })
    await render({ client })
    let first!: Promise<void>, second!: Promise<void>
    act(() => {
      first = current.create()
      second = current.create()
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
    await act(async () => {
      status.resolve(supported)
      await Promise.all([first, second])
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'status.get',
      'worktree.show',
      'files.createFile',
      'files.open'
    ])
    expect(current.creating).toBe(false)
  })

  it('stops preflight before worktree.show when the host/client changes', async () => {
    const status = deferred()
    const first = clientWithResponses((method) => {
      if (method === 'status.get') {
        return status.promise
      }
      return success({ worktree: { hostId: 'local' } })
    })
    const second = clientWithResponses(() => success())
    await render({ client: first.client })
    let pending!: Promise<void>
    act(() => {
      pending = current.create()
    })
    await render({ client: second.client, hostId: 'host-b', worktreeId: 'worktree-b' })
    await act(async () => {
      status.resolve(supported)
      await pending
    })
    expect(first.sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
    expect(second.sendRequest).not.toHaveBeenCalled()
    expect(current.creating).toBe(false)
    expect(current.error).toBe('')
  })

  it('stops preflight after unmount without issuing a file mutation', async () => {
    const status = deferred()
    const { client, sendRequest } = clientWithResponses((method) =>
      method === 'status.get' ? status.promise : success({ worktree: { hostId: 'local' } })
    )
    await render({ client })
    const pending = current.create()
    act(() => renderer?.unmount())
    await act(async () => {
      status.resolve(supported)
      await pending
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
  })

  it('does not open an accepted A file after B owns the screen', async () => {
    const createFile = deferred()
    const old = clientWithResponses((method) => {
      if (method === 'status.get') {
        return supported
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      if (method === 'files.createFile') {
        return createFile.promise
      }
      return success()
    })
    const next = clientWithResponses(() => success())
    const fetch = vi.fn()
    const schedule = vi.fn()
    await render({ client: old.client, onFetch: fetch, onSchedule: schedule })
    let pending!: Promise<void>
    await act(async () => {
      pending = current.create()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(old.sendRequest.mock.calls.map((call) => call[0])).toContain('files.createFile')
    await render({ client: next.client, hostId: 'host-b', worktreeId: 'worktree-b' })
    await act(async () => {
      createFile.resolve(success())
      await pending
    })
    expect(old.sendRequest.mock.calls.map((call) => call[0])).not.toContain('files.open')
    expect(schedule).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not accept old A completion after A → B → A', async () => {
    const oldStatus = deferred()
    let statusCount = 0
    const a = clientWithResponses((method) => {
      if (method === 'status.get' && statusCount++ === 0) {
        return oldStatus.promise
      }
      if (method === 'status.get') {
        return supported
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      return success()
    })
    const b = clientWithResponses(() => success())
    await render({ client: a.client })
    let old!: Promise<void>
    act(() => {
      old = current.create()
    })
    await render({ client: b.client, hostId: 'host-b' })
    await render({ client: a.client })
    await act(async () => current.create())
    await act(async () => {
      oldStatus.resolve(supported)
      await old
    })
    expect(a.sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
    await act(async () => current.create())
    expect(a.sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'status.get',
      'status.get',
      'worktree.show',
      'files.createFile',
      'files.open'
    ])
  })

  it('keeps B claimed while A finishes and allows a same-source retry after failure', async () => {
    const oldStatus = deferred()
    const newStatus = deferred()
    const a = clientWithResponses((method) =>
      method === 'status.get' ? oldStatus.promise : success({ worktree: { hostId: 'local' } })
    )
    let bCreateCount = 0
    const b = clientWithResponses((method) => {
      if (method === 'status.get') {
        return newStatus.promise
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      if (method === 'files.createFile' && bCreateCount++ === 0) {
        return { ok: false, error: { message: 'B create failed' } }
      }
      return success()
    })
    const toast = vi.fn()
    await render({ client: a.client })
    const old = current.create()
    await render({ client: b.client, hostId: 'host-b', onToast: toast })
    const next = current.create()
    await act(async () => {
      oldStatus.resolve(supported)
      await old
    })
    expect(current.creating).toBe(true)
    await act(async () => current.create())
    expect(b.sendRequest.mock.calls.map((call) => call[0])).toEqual(['status.get'])
    await act(async () => {
      newStatus.resolve(supported)
      await next
    })
    expect(current.error).toBe('B create failed')
    expect(toast).toHaveBeenCalledWith('B create failed', 1800)
    expect(current.creating).toBe(false)
    await act(async () => current.create())
    expect(b.sendRequest.mock.calls.filter((call) => call[0] === 'files.createFile')).toHaveLength(
      2
    )
    expect(b.sendRequest.mock.calls.map((call) => call[0])).toContain('files.open')
    expect(current.error).toBe('')
  })

  it('does not start a second canonical A create while an accepted A create is unresolved across ABA', async () => {
    const firstCreate = deferred()
    let createCount = 0
    const a = clientWithResponses((method) => {
      if (method === 'status.get') {
        return supported
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'local' } })
      }
      if (method === 'files.createFile' && createCount++ === 0) {
        return firstCreate.promise
      }
      return success()
    })
    const b = clientWithResponses(() => success())
    await render({ client: a.client })
    let old!: Promise<void>
    await act(async () => {
      old = current.create()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(a.sendRequest.mock.calls.map((call) => call[0])).toContain('files.createFile')
    await render({ client: b.client, hostId: 'host-b' })
    await render({ client: a.client })
    expect(current.creating).toBe(true)
    await act(async () => current.create())
    expect(a.sendRequest.mock.calls.filter((call) => call[0] === 'status.get')).toHaveLength(1)
    await act(async () => {
      firstCreate.resolve(success())
      await old
    })
    expect(current.creating).toBe(false)
    expect(a.sendRequest.mock.calls.map((call) => call[0])).not.toContain('files.open')
    await act(async () => current.create())
    expect(a.sendRequest.mock.calls.filter((call) => call[0] === 'status.get')).toHaveLength(2)
  })

  it('preserves SSH owner, folder worktree, collision retry and refresh timing', async () => {
    const calls: string[] = []
    const scheduled: (() => void)[] = []
    const fetch = vi.fn()
    const { client, sendRequest } = clientWithResponses((method) => {
      calls.push(method)
      if (method === 'status.get') {
        return supported
      }
      if (method === 'worktree.show') {
        return success({ worktree: { hostId: 'ssh:target-1' } })
      }
      if (method === 'ssh.getState') {
        return success({
          state: { targetId: 'target-1', status: 'connected', connectionGeneration: 7 }
        })
      }
      if (method === 'files.createFile' && calls.filter((call) => call === method).length === 1) {
        return { ok: false, error: { message: 'EEXIST: already exists' } }
      }
      return success()
    })
    await render({
      client,
      worktreeId: 'folder:notes',
      onFetch: fetch,
      onSchedule: (callback, ms) => {
        expect(ms).toBe(300)
        scheduled.push(callback)
      }
    })
    await act(async () => current.create())
    expect(sendRequest.mock.calls.filter((call) => call[0] === 'files.createFile')).toEqual([
      [
        'files.createFile',
        {
          worktree: 'id:folder:notes',
          relativePath: 'untitled.md',
          expectedExecutionHostId: 'ssh:target-1',
          expectedSshTargetId: 'target-1',
          expectedSshConnectionGeneration: 7
        },
        { timeoutMs: 15_000 }
      ],
      [
        'files.createFile',
        {
          worktree: 'id:folder:notes',
          relativePath: 'untitled-2.md',
          expectedExecutionHostId: 'ssh:target-1',
          expectedSshTargetId: 'target-1',
          expectedSshConnectionGeneration: 7
        },
        { timeoutMs: 15_000 }
      ]
    ])
    expect(sendRequest.mock.calls.find((call) => call[0] === 'files.open')?.[1]).toEqual({
      worktree: 'id:folder:notes',
      relativePath: 'untitled-2.md'
    })
    expect(scheduled).toHaveLength(1)
    act(() => scheduled[0]())
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not run a scheduled refresh after the source changes', async () => {
    const callbacks: (() => void)[] = []
    const client = clientWithResponses((method) =>
      method === 'status.get'
        ? supported
        : method === 'worktree.show'
          ? success({ worktree: { hostId: 'local' } })
          : success()
    )
    const next = clientWithResponses(() => success())
    const fetch = vi.fn()
    await render({
      client: client.client,
      onFetch: fetch,
      onSchedule: (callback) => callbacks.push(callback)
    })
    await act(async () => current.create())
    expect(callbacks).toHaveLength(1)
    await render({ client: next.client, hostId: 'host-b' })
    await render({ client: client.client })
    act(() => callbacks[0]())
    expect(fetch).not.toHaveBeenCalled()
  })
})
