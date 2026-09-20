import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { useMobilePrAiTriage } from './use-mobile-pr-ai-triage'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferred() {
  let resolve!: (response: RpcResponse) => void
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
type Input = Parameters<typeof useMobilePrAiTriage>[0]

describe('PR triage launch ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let latest!: ReturnType<typeof useMobilePrAiTriage>
  let input: Input
  let sendRequest: ReturnType<typeof vi.fn>

  function Harness(props: Input) {
    latest = useMobilePrAiTriage(props)
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
      prNumber: 7
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['unmount', 'client', 'worktree', 'PR', 'disconnect'])(
    'does not send a staged prompt after %s changes its owner',
    async (change) => {
      const pending = deferred()
      sendRequest.mockReturnValueOnce(pending.promise)
      await render()
      let launch!: Promise<boolean>
      act(() => {
        launch = latest.launch('fix-checks', () => 'fix old checks')
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
          ...(change === 'disconnect' ? { connState: 'disconnected' as const } : {})
        })
      }
      await act(async () => {
        pending.resolve(created)
        await launch
      })
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(await launch).toBe(false)
      expect(triggerSuccess).not.toHaveBeenCalled()
    }
  )

  it('keeps a late failure out of a replacement worktree', async () => {
    const pending = deferred()
    sendRequest.mockReturnValueOnce(pending.promise)
    await render()
    let launch!: Promise<boolean>
    act(() => {
      launch = latest.launch('fix-checks', () => 'old prompt')
    })
    await render({ ...input, worktreeId: 'B' })
    await act(async () => {
      pending.reject(new Error('old failure'))
      await launch
    })
    expect(latest.error).toBeNull()
    expect(triggerError).not.toHaveBeenCalled()
  })

  it('blocks an ABA duplicate until the old attempt settles and releases its busy state', async () => {
    const pending = deferred()
    sendRequest.mockReturnValueOnce(pending.promise)
    await render()
    let launch!: Promise<boolean>
    act(() => {
      launch = latest.launch('fix-checks', () => 'old prompt')
    })
    await render({ ...input, worktreeId: 'B' })
    expect(latest.isBusy('fix-checks')).toBe(false)
    await render({ ...input, worktreeId: 'A' })
    expect(latest.isBusy('fix-checks')).toBe(true)
    await act(async () => {
      expect(await latest.launch('fix-checks', () => 'duplicate')).toBe(false)
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(created)
      await launch
    })
    expect(latest.isBusy('fix-checks')).toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('sends once for a current owner even when tapped twice in one render', async () => {
    const pending = deferred()
    sendRequest.mockReturnValueOnce(pending.promise)
    await render()
    let launch!: Promise<boolean>
    let duplicate!: Promise<boolean>
    act(() => {
      launch = latest.launch('fix-checks', () => 'prompt')
      duplicate = latest.launch('fix-checks', () => 'duplicate')
    })
    expect(await duplicate).toBe(false)
    await act(async () => {
      pending.resolve(created)
      await launch
    })
    expect(await launch).toBe(true)
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'session.tabs.createTerminal',
      'terminal.send'
    ])
    expect(triggerSuccess).toHaveBeenCalledOnce()
    expect(latest.isBusy('fix-checks')).toBe(false)
  })

  it('does not release a new worktree attempt when the old create completes', async () => {
    const oldCreate = deferred()
    const newCreate = deferred()
    sendRequest.mockReturnValueOnce(oldCreate.promise).mockReturnValueOnce(newCreate.promise)
    await render()
    const staleLaunch = latest.launch
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = latest.launch('fix-checks', () => 'A')
    })
    await render({ ...input, worktreeId: 'B' })
    await act(async () => {
      expect(await staleLaunch('fix-checks', () => 'stale A')).toBe(false)
    })
    act(() => {
      second = latest.launch('resolve-conflicts', () => 'B')
    })
    await act(async () => {
      oldCreate.resolve(created)
      await first
    })
    expect(latest.isBusy('resolve-conflicts')).toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await act(async () => {
      newCreate.resolve(created)
      await second
    })
    expect(sendRequest.mock.calls[2]).toEqual([
      'terminal.send',
      { terminal: 'term', text: 'B', enter: true }
    ])
    expect(latest.isBusy('resolve-conflicts')).toBe(false)
  })

  it('does not replay an already dispatched send or publish its late result on a new PR', async () => {
    const sent = deferred()
    sendRequest.mockResolvedValueOnce(created).mockReturnValueOnce(sent.promise)
    await render()
    let launch!: Promise<boolean>
    await act(async () => {
      launch = latest.launch('fix-checks', () => 'A')
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await render({ ...input, prNumber: 8 })
    await act(async () => {
      sent.resolve(accepted)
      await launch
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(latest.error).toBeNull()
  })

  it.each([
    ['github.com', true],
    ['github.example.test', false]
  ])('uses canonical repository identity for a refreshed %s PR', async (host, shouldSend) => {
    const pending = deferred()
    sendRequest.mockReturnValueOnce(pending.promise)
    await render({ ...input, prRepo: { owner: 'Orca', repo: 'Client' } })
    let launch!: Promise<boolean>
    act(() => {
      launch = latest.launch('fix-checks', () => 'prompt')
    })
    await render({ ...input, prRepo: { host, owner: 'orca', repo: 'client' } })
    await act(async () => {
      pending.resolve(created)
      await launch
    })
    expect(await launch).toBe(shouldSend)
    expect(sendRequest).toHaveBeenCalledTimes(shouldSend ? 2 : 1)
  })
})
