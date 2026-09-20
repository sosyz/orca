import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeClaudeTranscriptLine } from '../../../src/main/native-chat/transcript-line-decoders-claude'
import { createNativeChatMerger } from '../../../src/shared/native-chat-merge'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { applyMobileNativeChatStreamFrame } from './mobile-native-chat-stream-frame'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))

const input = { questions: [{ question: 'Continue?', options: ['Yes', 'No'] }] }

function call(
  id: unknown,
  messageId = `message-${String(id)}`,
  questions = input
): NativeChatMessage {
  return decodeClaudeTranscriptLine(
    JSON.stringify({
      uuid: messageId,
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: questions }] }
    }),
    'fallback'
  )!
}

const resultA = decodeClaudeTranscriptLine(
  JSON.stringify({
    uuid: 'result-a',
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool-a', content: 'Yes' }] }
  }),
  'fallback'
)!

describe('Claude transcript ask identity on mobile', () => {
  let renderer: ReactTestRenderer | null = null
  let state: ReturnType<typeof useMobileNativeChatAskDismiss>

  function Harness({
    messages,
    status = null,
    loading = false,
    enabled = true,
    renderCard = false
  }: {
    messages: NativeChatMessage[]
    status?: AgentStatusEntry | null
    loading?: boolean
    enabled?: boolean
    renderCard?: boolean
  }): ReactElement | null {
    const prompts = useMobileNativeChatPrompts({
      enabled,
      status,
      messages,
      transcriptLoading: loading
    })
    state = useMobileNativeChatAskDismiss({
      ...prompts,
      scopeKey: 'same-tab',
      sessionKey: 'same-session',
      observing: enabled && (prompts.detectedAsk !== null || !loading)
    })
    return renderCard && state.showAsk && prompts.ask
      ? createElement(MobileNativeChatAsk, {
          key: state.askKey,
          prompt: prompts.ask,
          onAnswer: async () => true
        })
      : null
  }

  async function render(props: Parameters<typeof Harness>[0]): Promise<void> {
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

  it('shows an identical new tool call when its predecessor result and new call arrive together', async () => {
    await render({ messages: [call('tool-a')] })
    const firstKey = state.askKey
    act(() => state.dismissAsk())
    await render({ messages: [call('tool-a')] })
    expect(state.showAsk).toBe(false)

    await render({ messages: [call('tool-a'), resultA, call('tool-b')] })
    expect(state.showAsk).toBe(true)
    expect(state.askKey).not.toBe(firstKey)
  })

  it('keeps the dismissed request through an unidentified sticky status and unsettled reads', async () => {
    const messages = [call('tool-a')]
    await render({ messages })
    act(() => state.dismissAsk())
    await render({
      messages,
      status: { state: 'working', interactivePrompt: JSON.stringify(input) } as AgentStatusEntry
    })
    expect(state.showAsk).toBe(false)
    await render({ messages, loading: true })
    await render({ messages, enabled: false })
    await render({ messages })
    expect(state.showAsk).toBe(false)

    await render({ messages: [...messages, resultA, call('tool-b')] })
    expect(state.showAsk).toBe(true)
  })

  it('does not let an old answer dismiss a newer same-content request', async () => {
    await render({ messages: [call('tool-a')] })
    const finishA = state.dismissAsk
    await render({ messages: [call('tool-a'), resultA, call('tool-b')] })
    act(() => finishA())
    expect(state.showAsk).toBe(true)
  })

  it('retains legacy content dismissal when the originally answered request had no identity', async () => {
    await render({ messages: [call(undefined, 'legacy-a')] })
    act(() => state.dismissAsk())
    await render({ messages: [call(undefined, 'legacy-a'), resultA, call('tool-b')] })
    expect(state.showAsk).toBe(false)

    await render({ messages: [] })
    await render({ messages: [call('tool-b')] })
    expect(state.showAsk).toBe(true)
  })

  it('does not associate an unidentified live prompt with a transcript request', async () => {
    const status = {
      state: 'waiting',
      interactivePrompt: JSON.stringify(input)
    } as AgentStatusEntry
    await render({ messages: [call('tool-a')], status })
    act(() => state.dismissAsk())
    await render({ messages: [call('tool-a'), resultA, call('tool-b')], status })
    expect(state.showAsk).toBe(false)
  })

  it('learns the first explicit identity without resurfacing and accepts the next proven request', async () => {
    await render({ messages: [call(undefined, 'same-message')] })
    const oldCompletion = state.dismissAsk
    act(() => state.dismissAsk())
    await render({ messages: [call('tool-a', 'same-message')] })
    expect(state.showAsk).toBe(false)
    await render({ messages: [call(undefined, 'same-message')] })
    expect(state.showAsk).toBe(false)
    await render({ messages: [call('tool-b', 'next-message')] })
    expect(state.showAsk).toBe(true)
    act(() => oldCompletion())
    expect(state.showAsk).toBe(true)
  })

  it('preserves the answer step when identity metadata appears or disappears', async () => {
    const questions = {
      questions: [
        { question: 'First?', options: ['Yes'] },
        { question: 'Second?', options: ['No'] }
      ]
    }
    const show = (id: unknown) =>
      render({ messages: [call(id, 'same-message', questions)], renderCard: true })
    const press = (label: string) =>
      renderer!.root
        .findAllByType('Pressable')
        .find((node) =>
          node.findAllByType('Text').some((text) => text.children.join('') === label)
        )!
        .props.onPress()
    const step = () =>
      renderer!.root
        .findAllByType('Text')
        .find((node) => /^\d\/2$/.test(node.children.join('')))
        ?.children.join('')
    await show(undefined)
    act(() => press('Yes'))
    await act(async () => press('Next'))
    expect(step()).toBe('2/2')

    await show('tool-a')
    expect(step()).toBe('2/2')
    await show(undefined)
    expect(step()).toBe('2/2')
    await show('tool-b')
    expect(step()).toBe('1/2')
  })

  it('retains an added tool identity when a same-message reconnect replay replaces the cached row', async () => {
    const merger = createNativeChatMerger()
    const frame = (message: NativeChatMessage) =>
      applyMobileNativeChatStreamFrame({
        merger,
        frame: JSON.parse(JSON.stringify({ type: 'snapshot', messages: [message] })),
        limit: 40,
        replaceSnapshot: false
      })
    frame(call(undefined, 'same-message'))
    const replay = frame(call('tool-a', 'same-message'))
    expect(replay.kind).toBe('messages')
    expect(merger.list).toHaveLength(1)
    expect(merger.list[0]?.blocks[0]).toHaveProperty('toolCallId', 'tool-a')
  })

  it.each([undefined, null, '', '   ', 42, {}])('omits invalid tool identity %j', (id) => {
    expect(call(id).blocks[0]).not.toHaveProperty('toolCallId')
  })
})
