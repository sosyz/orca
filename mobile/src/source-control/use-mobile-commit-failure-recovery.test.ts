import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { useMobileCommitFailureRecovery } from './use-mobile-commit-failure-recovery'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferred() {
  let resolve!: (value: RpcResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RpcResponse>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const created: RpcResponse = {
  id: 'create',
  ok: true,
  result: { tab: { type: 'terminal', id: 'tab', terminal: 'term' } }
}
const accepted: RpcResponse = { id: 'send', ok: true, result: { send: { accepted: true } } }
type Input = Parameters<typeof useMobileCommitFailureRecovery>[0]

describe('commit failure agent launch', () => {
  let renderer: ReactTestRenderer | null = null
  let input: Input
  let latest!: ReturnType<typeof useMobileCommitFailureRecovery>
  let sendRequest: ReturnType<typeof vi.fn>
  function Harness(props: Input) {
    latest = useMobileCommitFailureRecovery(props)
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
    sendRequest = vi.fn().mockResolvedValue(accepted)
    input = {
      client: { sendRequest } as unknown as RpcClient,
      connState: 'connected',
      worktreeId: 'A',
      failure: { error: 'pre-commit: lint failed', commitMessage: 'Fix reader', stagedEntries: [] }
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('synchronously claims one create for two taps before React commits', async () => {
    const pending = deferred()
    sendRequest.mockReturnValue(pending.promise)
    await render()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = latest.launch()
      second = latest.launch()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    sendRequest.mockResolvedValue(accepted)
    await act(async () => {
      pending.resolve(created)
      await Promise.all([first, second])
    })
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it.each(['dismiss', 'new failure', 'worktree', 'disconnect', 'unmount'])(
    'stops the unsent prompt after %s',
    async (change) => {
      const pending = deferred()
      sendRequest.mockReturnValueOnce(pending.promise)
      await render()
      let launched!: Promise<boolean>
      act(() => {
        launched = latest.launch()
      })
      if (change === 'unmount') {
        act(() => renderer?.unmount())
        renderer = null
      } else {
        await render({
          ...input,
          ...(change === 'dismiss' ? { failure: null } : {}),
          ...(change === 'new failure'
            ? { failure: { ...input.failure!, error: 'new hook failure' } }
            : {}),
          ...(change === 'worktree' ? { worktreeId: 'B' } : {}),
          ...(change === 'disconnect' ? { connState: 'disconnected' as const } : {})
        })
      }
      await act(async () => {
        pending.resolve(created)
        await launched
      })
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(await launched).toBe(false)
      expect(triggerSuccess).not.toHaveBeenCalled()
    }
  )

  it('does not expose an old launch error in a new commit failure', async () => {
    const pending = deferred()
    sendRequest.mockReturnValueOnce(pending.promise)
    await render()
    let launched!: Promise<boolean>
    act(() => {
      launched = latest.launch()
    })
    await render({ ...input, failure: { ...input.failure!, error: 'new failure' } })
    await act(async () => {
      pending.reject(new Error('old RPC failure'))
      await launched
    })
    expect(latest.launchError).toBeNull()
    expect(triggerError).not.toHaveBeenCalled()
  })
})
