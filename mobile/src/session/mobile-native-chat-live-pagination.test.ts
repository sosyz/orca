import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  useMobileNativeChatSession,
  type MobileNativeChatSession
} from './use-mobile-native-chat-session'

const message = (id: string, text = id): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text }],
  timestamp: 1,
  source: 'transcript'
})
const messages = (count: number, prefix = 'm') =>
  Array.from({ length: count }, (_, i) => message(`${prefix}${i}`))

describe('native chat paging after bounded live appends', () => {
  let renderer: ReactTestRenderer | undefined
  let state: MobileNativeChatSession
  let emit: (frame: unknown) => void
  const sendRequest = vi.fn()

  async function mount(snapshot: object) {
    const client = {
      sendRequest,
      subscribe: (_method: string, _params: unknown, onData: typeof emit) => {
        emit = onData
        onData({ type: 'snapshot', ...snapshot })
        return () => {}
      }
    } as unknown as RpcClient
    function Harness() {
      state = useMobileNativeChatSession({
        client,
        sourceIdentity: 'host-a/workspace-a',
        agent: 'claude',
        sessionId: 'session-a',
        transcriptPath: null
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  afterEach(async () => {
    await act(async () => renderer?.unmount())
    renderer = undefined
    sendRequest.mockReset()
  })

  it('exposes earlier history after the 41st message and restores the trimmed first message', async () => {
    await mount({ messages: messages(40), hasMore: false, beforeOffset: 0 })
    expect(state.hasMore).toBe(false)
    await act(async () => emit({ type: 'appended', messages: [message('m40')] }))
    expect(state.messages).toHaveLength(40)
    expect(state.messages[0]?.id).toBe('m1')
    expect(state.hasMore).toBe(true)
    sendRequest.mockResolvedValue({
      ok: true,
      result: { messages: messages(41), hasMore: false, beforeOffset: 0 }
    })
    await act(async () => state.loadEarlier())
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith('nativeChat.readSession', {
      agent: 'claude',
      sessionId: 'session-a',
      limit: 100
    })
    expect(state.messages).toEqual(messages(41))
    expect(state.hasMore).toBe(false)
  })

  it.each(['current', 'legacy'])(
    'reopens history when an initially empty %s host stream grows past its window',
    async (host) => {
      await mount({
        messages: [],
        ...(host === 'current' ? { hasMore: false, beforeOffset: 0 } : {})
      })
      await act(async () => emit({ type: 'appended', messages: messages(40) }))
      expect(state.hasMore).toBe(false)
      await act(async () => emit({ type: 'appended', messages: [message('m40')] }))
      expect(state.messages).toHaveLength(40)
      expect(state.hasMore).toBe(true)
    }
  )

  it('keeps already-known earlier history available through a live trim', async () => {
    await mount({ messages: messages(40), hasMore: true, beforeOffset: 200 })
    await act(async () => emit({ type: 'appended', messages: [message('m40')] }))
    expect(state.hasMore).toBe(true)
    expect(state.messages).toHaveLength(40)
  })

  it('exposes trimmed history when the first append arrives as one oversized batch', async () => {
    await mount({ messages: [], hasMore: false, beforeOffset: 0 })
    await act(async () => emit({ type: 'appended', messages: messages(41) }))
    expect(state.messages).toHaveLength(40)
    expect(state.messages[0]?.id).toBe('m1')
    expect(state.hasMore).toBe(true)
    sendRequest.mockResolvedValue({
      ok: true,
      result: { messages: messages(41), hasMore: false, beforeOffset: 0 }
    })
    await act(async () => state.loadEarlier())
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith('nativeChat.readSession', {
      agent: 'claude',
      sessionId: 'session-a',
      limit: 100
    })
    expect(state.messages[0]?.id).toBe('m0')
  })

  it('does not claim missing history for duplicates or in-place message updates', async () => {
    await mount({ messages: messages(40), hasMore: false, beforeOffset: 0 })
    await act(async () =>
      emit({ type: 'appended', messages: [message('m39'), message('m0', 'updated')] })
    )
    expect(state.hasMore).toBe(false)
    expect(state.messages).toHaveLength(40)
    expect(state.messages[0]).toEqual(message('m0', 'updated'))
    await act(async () => state.loadEarlier())
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('retains the 2000-message maximum after paging and further live appends', async () => {
    await mount({ messages: messages(40), hasMore: true, beforeOffset: 100_000 })
    let page = 0
    sendRequest.mockImplementation(async (_method, params) => ({
      ok: true,
      result: {
        messages: messages(params.limit, `page${page++}-`),
        hasMore: true,
        beforeOffset: 100_000 - page * 100
      }
    }))
    for (let i = 0; i < 33; i++) {
      await act(async () => state.loadEarlier())
    }
    expect(state.messages).toHaveLength(2000)
    expect(state.hasMore).toBe(false)
    await act(async () => emit({ type: 'appended', messages: [message('new-live')] }))
    expect(state.messages).toHaveLength(2000)
    expect(state.messages.at(-1)?.id).toBe('new-live')
    expect(state.hasMore).toBe(false)
    await act(async () => state.loadEarlier())
    expect(sendRequest).toHaveBeenCalledTimes(33)
  })
})
