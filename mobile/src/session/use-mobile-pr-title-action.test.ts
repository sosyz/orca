import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { GitHubPrMutationOutcome } from './github-pr-mutations'
import { useMobilePrTitleAction, type PrTitleActionInput } from './use-mobile-pr-title-action'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('PR title action ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let latest!: ReturnType<typeof useMobilePrTitleAction>
  let input: PrTitleActionInput
  let updateTitle: ReturnType<typeof vi.fn>
  let refetch: ReturnType<typeof vi.fn>

  function Harness(props: PrTitleActionInput) {
    latest = useMobilePrTitleAction(props)
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
    updateTitle = vi.fn().mockResolvedValue({ ok: true })
    refetch = vi.fn()
    input = {
      client: { sendRequest: vi.fn() } as unknown as RpcClient,
      connState: 'connected',
      worktreeId: 'A',
      prNumber: 7,
      prRepo: { owner: 'Orca', repo: 'Client' },
      refetch,
      mutations: { updateTitle }
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['client', 'worktree', 'PR', 'repo', 'disconnect', 'unmount'])(
    'does not publish a completed %s owner mutation into its replacement',
    async (change) => {
      const pending = deferred<GitHubPrMutationOutcome>()
      updateTitle.mockReturnValueOnce(pending.promise)
      await render()
      let save!: Promise<boolean>
      act(() => {
        save = latest.setTitle('Old draft', 'Title 7')
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
        expect(latest.saving).toBe(false)
      }
      await act(async () => {
        pending.resolve({ ok: true })
        await save
      })
      expect(await save).toBe(false)
      expect(refetch).not.toHaveBeenCalled()
      expect(triggerSuccess).not.toHaveBeenCalled()
    }
  )

  it('keeps an old failure and stale callback out of the new PR', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    updateTitle.mockReturnValueOnce(pending.promise)
    await render()
    const staleSetTitle = latest.setTitle
    let save!: Promise<boolean>
    act(() => {
      save = latest.setTitle('Old draft', 'Title 7')
    })
    await render({ ...input, prNumber: 8 })
    expect(await staleSetTitle('Stale', 'Title 7')).toBe(false)
    await act(async () => {
      pending.resolve({ ok: false, error: 'old failure' })
      await save
    })
    expect(latest.error).toBeNull()
    expect(triggerError).not.toHaveBeenCalled()
    expect(updateTitle).toHaveBeenCalledTimes(1)
  })

  it('claims a synchronous double tap and keeps an ABA pending claim', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    updateTitle.mockReturnValueOnce(pending.promise)
    await render()
    let first!: Promise<boolean>
    let duplicate!: Promise<boolean>
    act(() => {
      first = latest.setTitle('First', 'Title 7')
      duplicate = latest.setTitle('Duplicate', 'Title 7')
    })
    expect(await duplicate).toBe(false)
    await render({ ...input, prNumber: 8 })
    await render({ ...input, prNumber: 7 })
    expect(latest.saving).toBe(true)
    expect(await latest.setTitle('ABA', 'Title 7')).toBe(false)
    expect(updateTitle).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ ok: true })
      await first
    })
    expect(await first).toBe(false)
    expect(latest.saving).toBe(false)
  })

  it('does not let an old completion clear a newer PR save in the same worktree', async () => {
    const old = deferred<GitHubPrMutationOutcome>()
    const next = deferred<GitHubPrMutationOutcome>()
    updateTitle.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    await render()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = latest.setTitle('Old', 'Title 7')
    })
    await render({ ...input, prNumber: 8 })
    act(() => {
      second = latest.setTitle('New', 'Title 8')
    })
    expect(updateTitle).toHaveBeenCalledTimes(2)
    await act(async () => {
      old.resolve({ ok: true })
      await first
    })
    expect(latest.saving).toBe(true)
    await act(async () => {
      next.resolve({ ok: true })
      await second
    })
    expect(await second).toBe(true)
    expect(latest.saving).toBe(false)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('preserves an in-flight title save across canonical github.com repo refresh', async () => {
    const pending = deferred<GitHubPrMutationOutcome>()
    updateTitle.mockReturnValueOnce(pending.promise)
    await render()
    let save!: Promise<boolean>
    act(() => {
      save = latest.setTitle('New title', 'Title 7')
    })
    await render({ ...input, prRepo: { host: 'github.com', owner: 'orca', repo: 'client' } })
    await act(async () => {
      pending.resolve({ ok: true })
      await save
    })
    expect(await save).toBe(true)
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('does not report success if ownership changes while the authoritative refetch is pending', async () => {
    const pendingRefetch = deferred<void>()
    refetch.mockReturnValue(pendingRefetch.promise)
    await render()
    let save!: Promise<boolean>
    act(() => {
      save = latest.setTitle('New title', 'Title 7')
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
    expect(latest.saving).toBe(false)
  })
})
