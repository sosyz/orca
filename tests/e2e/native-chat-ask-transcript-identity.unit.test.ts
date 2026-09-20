// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { decodeClaudeTranscriptLine } from '../../src/main/native-chat/transcript-line-decoders-claude'
import { NativeChatInteractiveCard } from '../../src/renderer/src/components/native-chat/NativeChatInteractiveCard'
import type { NativeChatInteractiveSend } from '../../src/renderer/src/components/native-chat/use-native-chat-interactive-send'
import type { NativeChatMessage } from '../../src/shared/native-chat-types'

vi.mock('../../src/renderer/src/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ agentStatusByPaneKey: {} })
}))

afterEach(cleanup)

it('carries Claude tool identity through the wire and desktop dismissal into the next identical request', () => {
  const input = { questions: [{ question: 'Continue?', options: ['Yes', 'No'] }] }
  const decode = (id: string, content: unknown[], type = 'assistant') =>
    decodeClaudeTranscriptLine(JSON.stringify({ uuid: id, type, message: { content } }), id)!
  const call = (id: string) =>
    decode(`message-${id}`, [{ type: 'tool_use', id, name: 'AskUserQuestion', input }])
  let settle: ((delivered: boolean) => void) | undefined
  const send: NativeChatInteractiveSend = {
    sendAnswer: (_prompt, _selections, callback) => {
      settle = callback
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    },
    sendRaw: vi.fn(),
    cancel: vi.fn(),
    cancelPending: vi.fn()
  }
  const element = (messages: NativeChatMessage[]) =>
    createElement(NativeChatInteractiveCard, {
      paneKey: 'same-pane',
      canSend: true,
      transcriptSettled: true,
      messages: JSON.parse(JSON.stringify(messages)),
      send
    })
  const rendered = render(element([call('tool-a')]))
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  act(() => settle?.(true))
  rendered.rerender(element([call('tool-a')]))
  expect(screen.queryByText('Continue?')).not.toBeInTheDocument()

  rendered.rerender(
    element([
      call('tool-a'),
      decode('result-a', [{ type: 'tool_result', tool_use_id: 'tool-a', content: 'Yes' }], 'user'),
      call('tool-b')
    ])
  )
  expect(screen.getByText('Continue?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Yes/ })).toHaveAttribute('aria-pressed', 'false')
})
