import { describe, expect, it, vi } from 'vitest'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'

const subscriptions = [
  {
    name: 'workspace tabs',
    method: 'session.tabs.subscribe',
    params: { worktree: 'id:folder-workspace-1' },
    snapshot: { type: 'snapshot', worktree: 'folder-workspace-1', tabs: [] },
    unsubscribe: {
      method: 'session.tabs.unsubscribe',
      params: { worktree: 'id:folder-workspace-1' }
    }
  },
  {
    name: 'native chat with an explicit cleanup token',
    method: 'nativeChat.subscribe',
    params: { agent: 'claude', sessionId: 'session-1', subscriptionId: 'chat-owner-1' },
    snapshot: { type: 'snapshot', messages: [], hasMore: false },
    unsubscribe: {
      method: 'nativeChat.unsubscribe',
      params: { subscriptionId: 'chat-owner-1' }
    }
  },
  {
    name: 'native chat with a legacy cleanup token',
    method: 'nativeChat.subscribe',
    params: { agent: 'codex', sessionId: 'session-1' },
    snapshot: { type: 'snapshot', messages: [], hasMore: false },
    unsubscribe: {
      method: 'nativeChat.unsubscribe',
      params: { subscriptionId: 'codex:session-1' }
    }
  }
] as const

function createStreams(waitForConnected = async (): Promise<void> => {}) {
  let nextId = 0
  const sendFrame = vi.fn(() => true)
  const streams = new MobileRelayRpcStreams({
    nextId: () => `request-${++nextId}`,
    sendFrame,
    waitForConnected
  })
  return { streams, sendFrame }
}

describe.each(subscriptions)('relay subscription cleanup: $name', (subscription) => {
  it.each([false, true])('releases the host listener with snapshot received=%s', async (ready) => {
    const { streams, sendFrame } = createStreams()
    const listener = vi.fn()
    const cancel = streams.subscribe(subscription.method, subscription.params, listener)
    await Promise.resolve()
    const snapshot = {
      id: 'request-1',
      ok: true as const,
      streaming: true as const,
      result: subscription.snapshot,
      _meta: { runtimeId: 'runtime-1' }
    }
    if (ready) {
      streams.handleResponse(snapshot)
    }

    cancel()
    cancel()

    expect(sendFrame).toHaveBeenCalledTimes(2)
    expect(sendFrame).toHaveBeenLastCalledWith({ id: 'request-2', ...subscription.unsubscribe })
    listener.mockClear()
    expect(streams.handleResponse(snapshot)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not cancel a sibling host listener when this request was never sent', async () => {
    const connection = Promise.withResolvers<void>()
    const { streams, sendFrame } = createStreams(() => connection.promise)
    const listener = vi.fn()
    const cancel = streams.subscribe(subscription.method, subscription.params, listener)

    cancel()
    connection.resolve()
    await Promise.resolve()

    expect(sendFrame).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })
})
