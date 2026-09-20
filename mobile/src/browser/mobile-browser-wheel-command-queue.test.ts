import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  MobileBrowserWheelCommandQueue,
  type MobileBrowserWheelCommand
} from './mobile-browser-wheel-command-queue'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const okResponse = { ok: true, result: {} } as const

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve()
  }
}

function command(overrides: Partial<MobileBrowserWheelCommand> = {}): MobileBrowserWheelCommand {
  return {
    base: { page: 'page-a', worktree: 'worktree-a' },
    dx: 0,
    dy: 10,
    gestureId: 1,
    point: { x: 30, y: 40 },
    ...overrides
  }
}

function makeClient(
  implementation?: (method: string, params: Record<string, unknown>) => Promise<unknown>
): RpcClient {
  return {
    sendRequest: vi.fn((method: string, params: Record<string, unknown>) =>
      implementation ? implementation(method, params) : Promise.resolve(okResponse)
    )
  } as unknown as RpcClient
}

describe('MobileBrowserWheelCommandQueue', () => {
  it('coalesces wheel deltas behind one ordered move-wheel command pair', async () => {
    const firstMove = deferred<typeof okResponse>()
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const client = makeClient((method, params) => {
      calls.push({ method, params })
      return calls.length === 1 ? firstMove.promise : Promise.resolve(okResponse)
    })
    const queue = new MobileBrowserWheelCommandQueue({
      onAccepted: vi.fn(),
      readClient: () => client
    })

    queue.enqueue(command({ dy: 10, point: { x: 10, y: 20 } }))
    queue.enqueue(command({ dy: 20, point: { x: 20, y: 30 } }))
    queue.enqueue(command({ dx: 2, dy: -5, point: { x: 25, y: 35 } }))

    expect(calls).toEqual([
      {
        method: 'browser.mouseMove',
        params: { page: 'page-a', worktree: 'worktree-a', x: 10, y: 20 }
      }
    ])

    firstMove.resolve(okResponse)
    await drainMicrotasks()

    expect(calls).toEqual([
      {
        method: 'browser.mouseMove',
        params: { page: 'page-a', worktree: 'worktree-a', x: 10, y: 20 }
      },
      {
        method: 'browser.mouseWheel',
        params: { dx: 0, dy: 10, page: 'page-a', worktree: 'worktree-a' }
      },
      {
        method: 'browser.mouseMove',
        params: { page: 'page-a', worktree: 'worktree-a', x: 25, y: 35 }
      },
      {
        method: 'browser.mouseWheel',
        params: { dx: 2, dy: 15, page: 'page-a', worktree: 'worktree-a' }
      }
    ])
  })

  it('lets a new scoped client send while an old client command is still hanging', async () => {
    const oldMove = deferred<typeof okResponse>()
    const oldClient = makeClient((method) =>
      method === 'browser.mouseMove' ? oldMove.promise : Promise.resolve(okResponse)
    )
    const newClient = makeClient()
    let currentClient: RpcClient | null = oldClient
    const accepted = vi.fn()
    const queue = new MobileBrowserWheelCommandQueue({
      onAccepted: accepted,
      readClient: () => currentClient
    })

    queue.enqueue(command({ dy: 12 }))
    queue.enqueue(command({ dy: 18 }))
    queue.cancel()
    currentClient = newClient
    queue.enqueue(
      command({
        base: { page: 'page-b', worktree: 'worktree-b' },
        dy: 24,
        gestureId: 2,
        point: { x: 100, y: 120 }
      })
    )
    await drainMicrotasks()

    expect(oldClient.sendRequest).toHaveBeenCalledTimes(1)
    expect(newClient.sendRequest).toHaveBeenCalledWith('browser.mouseMove', {
      page: 'page-b',
      worktree: 'worktree-b',
      x: 100,
      y: 120
    })
    expect(newClient.sendRequest).toHaveBeenCalledWith('browser.mouseWheel', {
      dx: 0,
      dy: 24,
      page: 'page-b',
      worktree: 'worktree-b'
    })

    oldMove.resolve(okResponse)
    await drainMicrotasks()

    expect(oldClient.sendRequest).toHaveBeenCalledTimes(1)
    expect(accepted).toHaveBeenCalledTimes(1)
  })
})
