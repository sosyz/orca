import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeClaudeTranscriptLine } from '../../../src/main/native-chat/transcript-line-decoders-claude'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import { resolveMobileNativeChat } from './mobile-native-chat-eligibility'

const view = vi.hoisted(() => ({
  messages: [] as NativeChatMessage[],
  folded: [] as NativeChatMessage[]
}))
vi.mock('react-native', () => ({ View: 'View', StyleSheet: { create: (value: unknown) => value } }))
vi.mock('./MobileNativeChatView', () => ({
  MobileNativeChatView: (props: typeof view) => {
    Object.assign(view, props)
    return null
  }
}))
vi.mock('./use-mobile-native-chat-streaming-bubble', () => ({
  useMobileNativeChatStreamingBubble: () => null
}))

function decode(text: string, role: 'user' | 'assistant' = 'user', id = role): NativeChatMessage {
  const message = decodeClaudeTranscriptLine(
    JSON.stringify({
      type: role,
      uuid: id,
      timestamp: '2026-09-19T00:00:00Z',
      message: { content: text }
    }),
    id
  )
  if (!message) {
    throw new Error('Expected a decoded transcript message')
  }
  return message
}
const envelope = (name: string, args = '') =>
  `<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`
let renderer: ReactTestRenderer | undefined
async function render(messages: NativeChatMessage[], agent: string | null) {
  const props = {
    controller: {
      nativeChatSession: { messages, status: 'ready', hasMore: false },
      nativeChatAgent: agent,
      showNativeChat: true,
      chatPending: []
    },
    images: {},
    keyboardInset: 0
  } as unknown as Parameters<typeof MobileNativeChatOverlay>[0]
  await act(async () => {
    renderer = create(createElement(MobileNativeChatOverlay, props))
  })
}
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('mobile skill invocation history', () => {
  it.each(['claude', 'openclaude'])(
    'renders host-decoded %s skills with arguments through the real overlay',
    async (agent) => {
      const messages = [
        decode(envelope('my-plugin:review-code', 'check the parser')),
        decode('I will inspect it.', 'assistant')
      ]
      await render(messages, agent)
      expect(view.folded.map((message) => message.id)).toEqual(['user', 'assistant'])
      expect(view.folded[0].blocks).toEqual([
        { type: 'text', text: '/review-code check the parser' }
      ])
      expect(view.messages).toBe(messages)
      expect(messages[0].blocks).toEqual([
        { type: 'text', text: envelope('my-plugin:review-code', 'check the parser') }
      ])
    }
  )

  it.each(['claude', 'openclaude'])(
    'keeps catalog commands hidden while exposing unknown %s skill names and plugin collisions',
    async (agent) => {
      const messages = [
        decode(envelope('clear'), 'user', 'catalog'),
        decode(envelope('review-code'), 'user', 'skill'),
        decode(envelope('my-plugin:clear', 'notes'), 'user', 'plugin'),
        decode('<system-reminder>runtime machinery</system-reminder>', 'user', 'noise')
      ]
      await render(messages, agent)
      expect(view.folded.map((message) => message.id)).toEqual(['skill', 'plugin'])
      expect(view.folded.flatMap((message) => message.blocks)).toEqual([
        { type: 'text', text: '/review-code' },
        { type: 'text', text: '/clear notes' }
      ])
    }
  )

  it('preserves assistant command examples and ordinary user XML', async () => {
    const messages = [
      decode('<custom-data>keep this</custom-data>'),
      decode(envelope('review-code'), 'assistant')
    ]
    await render(messages, 'claude')
    expect(view.folded).toEqual(messages)
    expect(view.folded[0]).toBe(messages[0])
    expect(view.folded[1]).toBe(messages[1])
  })

  it.each([null, 'unknown', 'codex', 'grok', 'omp'])(
    'does not surface command machinery without a Claude-family source: %s',
    async (agent) => {
      await render([decode(envelope('review-code'))], agent)
      expect(view.folded).toEqual([])
    }
  )

  it('preserves the no-agent fold fallback and resolves older hosts from their launch hint', async () => {
    const messages = [decode(envelope('review-code'))]
    expect(foldMobileNativeChatMessages(messages)).toEqual([])
    const source = resolveMobileNativeChat({ type: 'terminal', launchAgent: 'openclaude' })
    expect(source?.agent).toBe('openclaude')
    await render(messages, source?.agent ?? null)
    expect(view.folded[0]?.blocks).toEqual([{ type: 'text', text: '/review-code' }])
    expect(resolveMobileNativeChat({ type: 'terminal' })).toBeNull()
  })

  it('does not confirm a pending plain-text send from a shortened display-only skill token', async () => {
    const messages = [decode(envelope('my-plugin:review-code', 'check the parser'))]
    const pending = [
      {
        id: 'not-confirmed',
        text: '/review-code check the parser',
        expectedOccurrence: 1,
        baselineTailMessageId: null,
        baselineResolved: true
      }
    ]
    await render(messages, 'claude')
    expect(view.folded[0]?.blocks).toEqual([{ type: 'text', text: pending[0].text }])
    expect(view.messages).toBe(messages)
    expect(retireLandedMobileNativeChatPending(view.messages, pending, new Set())).toBe(pending)
  })
})
