import { describe, expect, it, vi } from 'vitest'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import type { RpcResponse } from './types'

type Request = { id: string; method: string; params?: unknown }
function setup(kind: 'direct' | 'relay', connected = true) {
  const requests: Request[] = []
  let id = 0
  const nextId = () => `rpc-${++id}`
  const send = (request: unknown) => {
    requests.push(request as Request)
    return true
  }
  const gate = Promise.withResolvers<void>()
  const client =
    kind === 'direct'
      ? new RpcClientStreamRegistry({
          nextId,
          deviceToken: 'test-token',
          getState: () => (connected ? 'connected' : 'connecting'),
          sendEncrypted: send
        })
      : new MobileRelayRpcStreams({
          nextId,
          sendFrame: send,
          waitForConnected: () => (connected ? Promise.resolve() : gate.promise)
        })
  const ready = (requestId: string, subscriptionId: string) =>
    client.handleResponse({
      id: requestId,
      ok: true,
      streaming: true,
      result: { type: 'ready', subscriptionId, snapshot: {} },
      _meta: { runtimeId: 'runtime-1' }
    } satisfies RpcResponse)
  return { client, requests, ready, gate }
}

describe.each(['direct', 'relay'] as const)('%s account subscription lifecycle', (kind) => {
  it.each([false, true])(
    'releases only the disposed account listener, ready=%s',
    async (readyFirst) => {
      const { client, requests, ready } = setup(kind)
      const accountListener = vi.fn()
      const siblingListener = vi.fn()
      const dispose = client.subscribe('accounts.subscribe', null, accountListener)
      client.subscribe('accounts.subscribe', null, siblingListener)
      await Promise.resolve()
      const first = requests[0]!.id
      const sibling = requests[1]!.id
      ready(sibling, 'accounts-home')
      if (readyFirst) {
        ready(first, 'accounts-screen')
      }
      accountListener.mockClear()

      dispose()
      dispose()
      if (!readyFirst) {
        ready(first, 'accounts-screen')
      }

      expect(requests.filter((request) => request.method === 'accounts.unsubscribe')).toEqual([
        expect.objectContaining({ params: { subscriptionId: 'accounts-screen' } })
      ])
      expect(accountListener).not.toHaveBeenCalled()
      expect(siblingListener).toHaveBeenCalledExactlyOnceWith({
        type: 'ready',
        subscriptionId: 'accounts-home',
        snapshot: {}
      })
      client.handleResponse({
        id: sibling,
        ok: true,
        streaming: true,
        result: { type: 'snapshot', snapshot: { updatedAt: 2 } },
        _meta: { runtimeId: 'runtime-1' }
      })
      expect(siblingListener).toHaveBeenCalledTimes(2)
    }
  )

  it('does not create or cancel a server listener when disposed before connect', async () => {
    const { client, requests, gate } = setup(kind, false)
    const dispose = client.subscribe('accounts.subscribe', null, vi.fn())
    dispose()
    gate.resolve()
    await Promise.resolve()
    expect(requests).toEqual([])
  })
})

it('uses the new account subscription token after reconnect', () => {
  const { client, requests, ready } = setup('direct')
  if (!(client instanceof RpcClientStreamRegistry)) {
    throw new Error('Expected direct registry')
  }
  const listener = vi.fn()
  const dispose = client.subscribe('accounts.subscribe', null, listener)
  const requestId = requests[0]!.id
  ready(requestId, 'accounts-old-socket')
  client.markForReplay()
  client.replayAfterAuthentication()
  dispose()
  ready(requestId, 'accounts-new-socket')
  expect(requests.filter((request) => request.method === 'accounts.unsubscribe')).toEqual([
    expect.objectContaining({ params: { subscriptionId: 'accounts-new-socket' } })
  ])
  expect(client.size()).toBe(0)
  expect(listener).toHaveBeenCalledTimes(1)
})
