import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../../../src/main/agent-hooks/server'
import { decodeClaudeTranscriptLine } from '../../../src/main/native-chat/transcript-line-decoders-claude'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { makePaneKey } from '../../../src/shared/stable-pane-id'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
const transcript = {
  messages: [] as NativeChatMessage[],
  status: 'ready',
  transcriptLoading: false
}
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => transcript
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: vi.fn(),
    readSeededLaunchDraft: vi.fn(),
    readSeededLaunchDraftSeed: vi.fn(),
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))
vi.mock('./use-mobile-native-chat-session-options', () => ({
  useMobileNativeChatSessionOptions: () => ({ snapshot: [], recordCommand: vi.fn() })
}))

const paneKey = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const sessionId = '22222222-2222-4222-8222-222222222222'
const input = (question: string, multiSelect = true) => ({
  questions: [{ question, multiSelect, options: [{ label: 'One' }, { label: 'Two' }] }]
})
const askEvent = (child: string, question: string, multiSelect = true) => ({
  hook_event_name: 'PreToolUse',
  agent_id: child,
  tool_use_id: `ask-${child}`,
  tool_name: 'AskUserQuestion',
  tool_input: input(question, multiSelect)
})
const accepted = () => ({
  id: 'send',
  ok: true as const,
  result: { send: { accepted: true } },
  _meta: { runtimeId: 'fixture' }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('native-chat answer request ownership through the real controller', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController
  let listener: ReturnType<typeof createHookListenerState>
  let server: AgentHookServer
  let status: AgentStatusEntry
  const sendRequest = vi.fn()
  const onSendError = vi.fn()
  const onSendResolved = vi.fn()
  const client = { sendRequest } as unknown as RpcClient
  const handleRef = { current: 'terminal-1' }
  const deviceTokenRef = { current: 'fixture-device' }

  function ingest(payload: Record<string, unknown>): void {
    const event = normalizeHookPayload(
      listener,
      'claude',
      { paneKey, payload: { session_id: sessionId, ...payload } },
      'production'
    )!
    listener.lastStatusByPaneKey.set(paneKey, event)
    server.ingestRemote(event, 'fixture-ssh-connection')
    status = server.getStatusSnapshot()[0]! as AgentStatusEntry
  }
  function Harness(): null {
    controller = useMobileNativeChatController({
      client,
      connState: 'connected',
      hostId: 'host-1',
      worktreeId: 'worktree-1',
      activeSessionTab: { type: 'terminal', launchAgent: 'claude', agentStatus: status },
      activeSessionTabId: 'tab-1',
      activeHandleRef: handleRef,
      deviceTokenRef,
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError,
      onSendResolved
    })
    return null
  }
  async function render(): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness))
      } else {
        renderer = create(createElement(Harness))
      }
    })
  }
  async function beginAnswer(): Promise<{ result: Promise<boolean> }> {
    let result!: Promise<boolean>
    await act(async () => {
      result = controller.handleNativeChatAnswerAsk(controller.nativeChatAsk!, [{ indices: [0] }])
    })
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['1'])
    return { result }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    onSendError.mockReset()
    onSendResolved.mockReset()
    resetMobileNativeChatTerminalWritesForTests()
    sendRequest.mockResolvedValue(accepted())
    transcript.messages = []
    listener = createHookListenerState()
    server = new AgentHookServer()
    ingest({ hook_event_name: 'UserPromptSubmit', prompt: 'coordinate background tasks' })
    ingest(askEvent('child-a', 'Which items should child A update?'))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('stops A pacing when another child publishes question B on the same terminal', async () => {
    await render()
    const keyA = controller.nativeChatAskKey
    const scopeA = controller.nativeChatStreamScopeKey
    const { result } = await beginAnswer()
    ingest(askEvent('child-b', 'Which items should child B delete?'))
    await render()
    expect(status.providerSession?.id).toBe(sessionId)
    expect(controller.nativeChatStreamScopeKey).toBe(scopeA)
    expect(controller.nativeChatAskKey).not.toBe(keyA)
    expect(controller.nativeChatAsk?.questions[0]?.question).toContain('child B')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await expect(result).resolves.toBe(false)
    expect(onSendError).not.toHaveBeenCalled()
    expect(onSendResolved).not.toHaveBeenCalled()
  })

  it('stops unsent keys when the question-owning child exits remotely', async () => {
    await render()
    const { result } = await beginAnswer()
    ingest({ hook_event_name: 'SubagentStop', agent_id: 'child-a' })
    await render()
    expect(controller.nativeChatAsk).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await expect(result).resolves.toBe(false)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('fences a delayed A receipt through A → B → A and releases its write claim', async () => {
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    await render()
    const keyA = controller.nativeChatAskKey
    const { result } = await beginAnswer()
    ingest(askEvent('child-b', 'Which items should child B delete?'))
    await render()
    ingest(askEvent('child-a', 'Which items should child A update?'))
    await render()
    expect(controller.nativeChatAskKey).not.toBe(keyA)
    await act(async () => first.resolve(accepted()))
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await expect(result).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).not.toHaveBeenCalled()
    sendRequest.mockClear()
    const next = await beginAnswer()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await expect(next.result).resolves.toBe(true)
  })

  it('does not let a detached A callback cancel B sending', async () => {
    await render()
    const answerA = controller.handleNativeChatAnswerAsk
    const promptA = controller.nativeChatAsk!
    ingest(askEvent('child-b', 'Which items should child B delete?'))
    await render()
    const next = await beginAnswer()
    await act(async () => {
      expect(await answerA(promptA, [{ indices: [0] }])).toBe(false)
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await expect(next.result).resolves.toBe(true)
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['1', '\x1b[C', '\r'])
    expect(onSendError).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'unknown'])('does not show A’s late %s result on B', async (outcome) => {
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    await render()
    const { result } = await beginAnswer()
    ingest(askEvent('child-b', 'Which items should child B delete?'))
    await render()
    await act(async () => {
      if (outcome === 'unknown') {
        first.reject(markRpcDeliveryUnknown(new Error('ack lost')))
      } else {
        first.resolve({ ...accepted(), result: { send: { accepted: false } } })
      }
    })
    await expect(result).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(controller.nativeChatAsk?.questions[0]?.question).toContain('child B')
    expect(onSendError).not.toHaveBeenCalled()
    expect(onSendResolved).not.toHaveBeenCalled()
  })

  it('does not let A’s accepted final group clear B’s newer cancellation error', async () => {
    let heldError: string | null = null
    onSendError.mockImplementation((message: string) => {
      heldError = message
    })
    onSendResolved.mockImplementation(() => {
      heldError = null
    })
    ingest(askEvent('child-a', 'Which items should child A update?', false))
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    await render()
    const dismissA = controller.dismissNativeChatAsk
    const { result } = await beginAnswer()
    ingest(askEvent('child-b', 'Which items should child B delete?'))
    await render()
    sendRequest.mockResolvedValueOnce({ ...accepted(), result: { send: { accepted: false } } })
    await act(async () => {
      expect(await controller.handleNativeChatCancelAsk()).toBe(false)
    })
    expect(heldError).toBe('Cancel not sent')
    await act(async () => {
      first.resolve(accepted())
      if (await result) {
        dismissA()
      }
    })
    expect(heldError).toBe('Cancel not sent')
    expect(onSendResolved).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['1', '\x1b'])
    expect(controller.nativeChatAsk?.questions[0]?.question).toContain('child B')
    expect(onSendError).toHaveBeenCalledTimes(1)
  })

  it('continues the same question through unrelated child status refresh', async () => {
    await render()
    const key = controller.nativeChatAskKey
    const { result } = await beginAnswer()
    ingest({ hook_event_name: 'PreToolUse', agent_id: 'child-b', tool_name: 'Read' })
    await render()
    expect(controller.nativeChatAskKey).toBe(key)
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await expect(result).resolves.toBe(true)
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['1', '\x1b[C', '\r'])
  })

  it('continues when transcript request identity is first filled in or temporarily absent', async () => {
    ingest({ hook_event_name: 'SubagentStop', agent_id: 'child-a' })
    const setTranscript = (id?: string): void => {
      transcript.messages = [
        decodeClaudeTranscriptLine(
          JSON.stringify({
            uuid: 'same-message',
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: input('Pick') }]
            }
          }),
          'fallback'
        )!
      ]
    }
    setTranscript()
    await render()
    const key = controller.nativeChatAskKey
    const { result } = await beginAnswer()
    setTranscript('tool-a')
    await render()
    expect(controller.nativeChatAskKey).toBe(key)
    setTranscript()
    await render()
    expect(controller.nativeChatAskKey).toBe(key)
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await expect(result).resolves.toBe(true)
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['1', '\x1b[C', '\r'])
  })
})
