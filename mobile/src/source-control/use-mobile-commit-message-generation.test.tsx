import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { useMobileCommitMessageGeneration } from './use-mobile-commit-message-generation'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const success = (message: string) => ({ ok: true, result: { success: true, message } })
type Props = { client: RpcClient; worktreeId: string }

describe('commit message generation ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let props: Props
  let rpc: ReturnType<typeof vi.fn>
  let latest!: ReturnType<typeof useMobileCommitMessageGeneration> & {
    draft: string
    generating: boolean
    error: string | null
    edit: (value: string) => void
  }
  function Harness(input: Props) {
    const [draft, edit] = useState('initial draft')
    const [generating, setGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const actions = useMobileCommitMessageGeneration({
      ...input,
      commitMessage: draft,
      mountedRef: useRef(true),
      busyActionRef: useRef(null),
      setCommitMessage: edit,
      setGeneratingMessage: setGenerating,
      setActionError: setError
    })
    latest = { ...actions, draft, generating, error, edit }
    return null
  }
  async function render(next = props) {
    props = next
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, props))
      } else {
        renderer = create(createElement(Harness, props))
      }
    })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    rpc = vi.fn()
    props = { client: { sendRequest: rpc } as unknown as RpcClient, worktreeId: 'wt' }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('preserves text written while the AI response is pending', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(pending.promise)
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    act(() => latest.edit('my new description'))
    await act(async () => {
      pending.resolve(success('generated description'))
      await request
    })
    expect(latest.draft).toBe('my new description')
    expect(latest.generating).toBe(false)
    expect(triggerSuccess).not.toHaveBeenCalled()
  })

  it('claims the request before same-batch duplicate presses', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(pending.promise)
    await render()
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = latest.generateCommitMessage()
      second = latest.generateCommitMessage()
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(success('generated'))
      await Promise.all([first, second])
    })
    expect(latest.draft).toBe('generated')
  })

  it('does not publish a success that crossed a cancel request', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockImplementation((method: string) =>
      method === 'git.generateCommitMessage'
        ? pending.promise
        : Promise.resolve({ ok: true, result: {} })
    )
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    act(() => latest.cancelGenerateCommitMessage())
    await act(async () => {
      pending.resolve(success('too late'))
      await request
    })
    expect(latest.draft).toBe('initial draft')
    expect(triggerSuccess).not.toHaveBeenCalled()
  })

  it('contains a rejected cancellation and allows another request after completion', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockImplementation((method: string) =>
      method === 'git.generateCommitMessage'
        ? pending.promise
        : Promise.reject(new Error('connection lost'))
    )
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    await act(async () => latest.cancelGenerateCommitMessage())
    expect(latest.error).toBe('connection lost')
    await act(async () => {
      pending.resolve(success('canceled response'))
      await request
    })
    rpc.mockResolvedValue(success('retry response'))
    await act(async () => latest.generateCommitMessage())
    expect(latest.draft).toBe('retry response')
    expect(latest.error).toBeNull()
  })

  it('preserves a draft edited and then changed back during generation', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(pending.promise)
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    act(() => latest.edit('replacement'))
    act(() => latest.edit('initial draft'))
    await act(async () => {
      pending.resolve(success('generated'))
      await request
    })
    expect(latest.draft).toBe('initial draft')
  })

  it('isolates a replacement client request from old completion and finally', async () => {
    const oldPending = deferred<ReturnType<typeof success>>()
    const newPending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(oldPending.promise)
    await render()
    let oldRequest!: Promise<void>
    act(() => {
      oldRequest = latest.generateCommitMessage()
    })
    const nextRpc = vi.fn().mockReturnValue(newPending.promise)
    await render({ ...props, client: { sendRequest: nextRpc } as unknown as RpcClient })
    expect(latest.generating).toBe(false)
    let newRequest!: Promise<void>
    act(() => {
      newRequest = latest.generateCommitMessage()
    })
    await act(async () => {
      oldPending.resolve(success('old client'))
      await oldRequest
    })
    expect(latest.draft).toBe('initial draft')
    expect(latest.generating).toBe(true)
    await act(async () => {
      newPending.resolve(success('new client'))
      await newRequest
    })
    expect(latest.draft).toBe('new client')
    expect(latest.generating).toBe(false)
  })

  it('keeps the original in-flight claim across worktree A to B to A', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(pending.promise)
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    await render({ ...props, worktreeId: 'other' })
    await render({ ...props, worktreeId: 'wt' })
    await act(async () => latest.generateCommitMessage())
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(success('first visit'))
      await request
    })
    expect(latest.draft).toBe('initial draft')
    expect(latest.generating).toBe(false)
  })

  it('ignores late results after unmount without relying on the view ref', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    rpc.mockReturnValue(pending.promise)
    await render()
    let request!: Promise<void>
    act(() => {
      request = latest.generateCommitMessage()
    })
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      pending.resolve(success('unmounted'))
      await request
    })
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(triggerError).not.toHaveBeenCalled()
  })
})
