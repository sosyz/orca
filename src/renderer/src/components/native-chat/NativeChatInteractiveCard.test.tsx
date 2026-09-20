// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { applyCommandMarkerBoundaries } from './native-chat-command-marker'
import type { NativeChatInteractiveSend } from './use-native-chat-interactive-send'

const INITIAL_PROMPT = JSON.stringify({
  questions: [
    {
      question: 'Tabs or spaces?',
      multiSelect: false,
      options: [{ label: 'Tabs' }, { label: 'Spaces' }]
    }
  ]
})

const storeState = {
  agentStatusByPaneKey: {
    'tab-1:leaf-1': {
      interactivePrompt: INITIAL_PROMPT as string | undefined,
      toolName: 'AskUserQuestion' as string | undefined,
      interactiveRequestKey: undefined as string | undefined,
      state: undefined as string | undefined
    }
  }
}

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

import { NativeChatInteractiveCard } from './NativeChatInteractiveCard'

const mocks = {
  sendAnswer: vi.fn<NativeChatInteractiveSend['sendAnswer']>(),
  sendRaw: vi.fn<NativeChatInteractiveSend['sendRaw']>(),
  cancelPending: vi.fn<NativeChatInteractiveSend['cancelPending']>(),
  cancel: vi.fn<NativeChatInteractiveSend['cancel']>()
}

function renderCard(canSend = true): ReturnType<typeof render> {
  return render(cardElement(canSend))
}

function cardElement(
  canSend = true,
  messages?: readonly NativeChatMessage[],
  onShowingQuestionChange?: (showing: boolean) => void,
  transcriptSettled = true
): React.JSX.Element {
  return (
    <NativeChatInteractiveCard
      paneKey="tab-1:leaf-1"
      canSend={canSend}
      messages={messages}
      transcriptSettled={transcriptSettled}
      onShowingQuestionChange={onShowingQuestionChange}
      send={{
        sendAnswer: mocks.sendAnswer,
        sendRaw: mocks.sendRaw,
        cancelPending: mocks.cancelPending,
        cancel: mocks.cancel
      }}
    />
  )
}

function askCallMessage(question: string): NativeChatMessage {
  return {
    id: `call-${question}`,
    role: 'assistant',
    createdAt: 1,
    blocks: [
      {
        type: 'tool-call',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question,
              header: 'Style',
              multiSelect: false,
              options: [{ label: 'Tabs' }, { label: 'Spaces' }]
            }
          ]
        }
      }
    ]
  } as unknown as NativeChatMessage
}

function askResultMessage(): NativeChatMessage {
  return {
    id: 'result-1',
    role: 'assistant',
    createdAt: 2,
    blocks: [{ type: 'tool-result', name: 'AskUserQuestion', output: 'Tabs' }]
  } as unknown as NativeChatMessage
}

function chooseSpacesAndSubmit(): void {
  fireEvent.click(screen.getByRole('button', { name: /Spaces/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
}

describe('NativeChatInteractiveCard answer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = INITIAL_PROMPT
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].state = undefined
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactiveRequestKey = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the card retryable when no PTY answer was sent', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 0, waitsForVerifiedDelivery: false })
    renderCard()

    chooseSpacesAndSubmit()
    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(mocks.sendAnswer).toHaveBeenCalledTimes(2)
  })

  it('shows a new identical approval only when its host request identity changes', () => {
    const status = storeState.agentStatusByPaneKey['tab-1:leaf-1']
    status.interactivePrompt = JSON.stringify({ approval: { tool: 'Bash', summary: 'pwd' } })
    status.interactiveRequestKey = 'request-a'
    const rendered = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(mocks.sendRaw).toHaveBeenCalledWith('1')
    rendered.rerender(cardElement())
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()

    status.interactiveRequestKey = 'request-b'
    rendered.rerender(cardElement())
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled()
  })

  it('retains content-based approval dismissal for hosts without request identity', () => {
    const status = storeState.agentStatusByPaneKey['tab-1:leaf-1']
    status.interactivePrompt = JSON.stringify({
      approval: { tool: 'Bash', summary: 'pwd' }
    })
    const rendered = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    rendered.rerender(cardElement())
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()

    status.interactiveRequestKey = 'first-known-request'
    rendered.rerender(cardElement())
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    status.interactiveRequestKey = 'next-known-request'
    rendered.rerender(cardElement())
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled()
  })

  it('keeps a dismissed approval hidden when its sticky status loses request identity', () => {
    const status = storeState.agentStatusByPaneKey['tab-1:leaf-1']
    status.interactivePrompt = JSON.stringify({ approval: { tool: 'Bash', summary: 'pwd' } })
    status.interactiveRequestKey = 'request-a'
    const rendered = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    status.state = 'working'
    status.interactiveRequestKey = undefined
    rendered.rerender(cardElement())
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()

    status.state = 'waiting'
    status.interactiveRequestKey = 'request-a'
    rendered.rerender(cardElement())
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    status.interactiveRequestKey = 'request-b'
    rendered.rerender(cardElement())
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled()
  })

  it('cancels delayed PTY writes when the owning card unmounts', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 5_000, waitsForVerifiedDelivery: false })
    const rendered = renderCard()

    chooseSpacesAndSubmit()
    expect(mocks.cancelPending).not.toHaveBeenCalled()

    rendered.unmount()
    expect(mocks.cancelPending).toHaveBeenCalledOnce()
  })

  it('cancels delayed PTY writes when desktop send authority is lost', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 5_000, waitsForVerifiedDelivery: false })
    const rendered = renderCard()

    chooseSpacesAndSubmit()
    rendered.rerender(cardElement(false))

    expect(mocks.cancelPending).toHaveBeenCalledOnce()
  })

  it('shows the paced send as busy and freezes the snapshotted answer', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 5_000, waitsForVerifiedDelivery: false })
    renderCard()

    chooseSpacesAndSubmit()

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Spaces/ })).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('cancels the old answer sequence when a replacement prompt arrives', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 5_000, waitsForVerifiedDelivery: false })
    const rendered = renderCard()
    chooseSpacesAndSubmit()

    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = JSON.stringify({
      questions: [
        {
          question: 'Choose a shell?',
          multiSelect: false,
          options: [{ label: 'zsh' }, { label: 'bash' }]
        }
      ]
    })
    rendered.rerender(cardElement())

    expect(mocks.cancelPending).toHaveBeenCalledOnce()
    expect(screen.getByText('Choose a shell?')).toBeInTheDocument()
  })

  it('keeps a verified send visible until delivery succeeds', () => {
    let settleDelivery: ((delivered: boolean) => void) | undefined
    mocks.sendAnswer.mockImplementation((_prompt, _selections, onDeliverySettled) => {
      settleDelivery = onDeliverySettled
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    })
    renderCard()

    chooseSpacesAndSubmit()
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()

    act(() => settleDelivery?.(true))
    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
  })

  it('restores a verified send for retry when delivery is rejected', () => {
    let settleDelivery: ((delivered: boolean) => void) | undefined
    mocks.sendAnswer.mockImplementation((_prompt, _selections, onDeliverySettled) => {
      settleDelivery = onDeliverySettled
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    })
    renderCard()

    chooseSpacesAndSubmit()
    act(() => settleDelivery?.(false))

    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()
  })
})

// A headless host, a relay gap, or a replay can leave the pane with no live
// `interactivePrompt` while the transcript still holds the unresolved call (#11761).
// Which asks the transcript still counts as pending (orphaned calls, turn boundaries)
// is the shared parser's contract — covered in `src/shared/native-chat-ask.test.ts`.
describe('NativeChatInteractiveCard transcript fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = undefined
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].state = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a new identical transcript tool request without resurfacing its sticky live predecessor', () => {
    const call = (id: string): NativeChatMessage => ({
      id: `message-${id}`,
      role: 'assistant',
      timestamp: 0,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          toolCallId: id,
          name: 'AskUserQuestion',
          input: JSON.parse(INITIAL_PROMPT)
        }
      ]
    })
    let settle: ((delivered: boolean) => void) | undefined
    mocks.sendAnswer.mockImplementation((_prompt, _selections, callback) => {
      settle = callback
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    })
    const messages = [call('tool-a')]
    const rendered = render(cardElement(true, messages))
    chooseSpacesAndSubmit()
    act(() => settle?.(true))
    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()

    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = INITIAL_PROMPT
    rendered.rerender(cardElement(true, messages))
    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = undefined
    rendered.rerender(cardElement(true, [messages[0]!, askResultMessage(), call('tool-b')]))
    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()
  })

  it('renders a pending transcript ask and reports the composer replacement', () => {
    const onShowingQuestionChange = vi.fn()
    render(cardElement(true, [askCallMessage('Tabs or spaces?')], onShowingQuestionChange))

    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()
    expect(onShowingQuestionChange).toHaveBeenCalledWith(true)
  })

  it('withholds a retained transcript ask while its replacement read is unsettled', () => {
    render(cardElement(true, [askCallMessage('Stale transcript question?')], undefined, false))

    expect(screen.queryByText('Stale transcript question?')).not.toBeInTheDocument()
  })

  it('prefers live status over the transcript when both carry a prompt', () => {
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].interactivePrompt = INITIAL_PROMPT
    render(cardElement(true, [askCallMessage('Stale transcript question?')]))

    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()
    expect(screen.queryByText('Stale transcript question?')).not.toBeInTheDocument()
  })

  it('still renders while the mirrored status says the agent is working', () => {
    // Why no state gate: the mirrored status channel is exactly what fails in the
    // reported topology, so keying the fallback on it would suppress the card.
    storeState.agentStatusByPaneKey['tab-1:leaf-1'].state = 'working'
    render(cardElement(true, [askCallMessage('Tabs or spaces?')]))

    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()
  })

  it('stays dismissed after answering while the transcript call is still pending', () => {
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 500, waitsForVerifiedDelivery: true })
    const messages = [askCallMessage('Tabs or spaces?')]
    const rendered = render(cardElement(true, messages))

    let settleDelivery: ((delivered: boolean) => void) | undefined
    mocks.sendAnswer.mockImplementation((_prompt, _selections, onDeliverySettled) => {
      settleDelivery = onDeliverySettled
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    })
    chooseSpacesAndSubmit()
    act(() => settleDelivery?.(true))
    rendered.rerender(cardElement(true, messages))

    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
  })

  it('keeps the dismissal while a reconnect transcript read is unsettled', () => {
    const messages = [askCallMessage('Tabs or spaces?')]
    let settle: ((delivered: boolean) => void) | undefined
    mocks.sendAnswer.mockImplementation((_prompt, _selections, callback) => {
      settle = callback
      return { settleAfterMs: 500, waitsForVerifiedDelivery: true }
    })
    const rendered = render(cardElement(true, messages))
    chooseSpacesAndSubmit()
    act(() => settle?.(true))
    rendered.rerender(cardElement(true, messages, undefined, false))
    rendered.rerender(cardElement(true, messages))
    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
  })

  it('keeps paced answers in flight while request identity metadata appears or disappears', () => {
    const legacy = askCallMessage('Tabs or spaces?')
    const identified = (id: string): NativeChatMessage => ({
      ...legacy,
      blocks: legacy.blocks.map((block) => ({ ...block, toolCallId: id }))
    })
    mocks.sendAnswer.mockReturnValue({ settleAfterMs: 500, waitsForVerifiedDelivery: true })
    const rendered = render(cardElement(true, [legacy]))
    chooseSpacesAndSubmit()
    rendered.rerender(cardElement(true, [identified('tool-a')]))
    expect(mocks.cancelPending).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    rendered.rerender(cardElement(true, [legacy]))
    expect(mocks.cancelPending).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()

    rendered.rerender(cardElement(true, [identified('tool-b')]))
    expect(mocks.cancelPending).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Sending…' })).not.toBeInTheDocument()
  })

  it('clears once the FIFO tool result lands', () => {
    const rendered = render(cardElement(true, [askCallMessage('Tabs or spaces?')]))
    expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument()

    rendered.rerender(cardElement(true, [askCallMessage('Tabs or spaces?'), askResultMessage()]))
    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
  })

  // The view passes the command-boundary-trimmed messages, so an ask abandoned via
  // `/clear` cannot come back as a permanent card sitting over the composer.
  it('drops an ask abandoned by /clear', () => {
    const abandoned = { ...askCallMessage('Tabs or spaces?'), timestamp: 100 }
    const trimmed = applyCommandMarkerBoundaries(
      [abandoned as unknown as NativeChatMessage],
      [{ id: 'clear-1', command: '/clear', sentAt: 200 }]
    )
    render(cardElement(true, trimmed))

    expect(screen.queryByText('Tabs or spaces?')).not.toBeInTheDocument()
  })
})
