import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../../../src/main/agent-hooks/server'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { makePaneKey } from '../../../src/shared/stable-pane-id'
import type { RpcClient } from '../transport/rpc-client'
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
vi.mock('./use-mobile-native-chat-session', () => {
  const snapshot = { messages: [], status: 'ready', transcriptLoading: false }
  return { useMobileNativeChatSession: () => snapshot }
})
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))
vi.mock('./use-mobile-native-chat-session-options', () => ({
  useMobileNativeChatSessionOptions: () => ({ snapshot: [], recordCommand: vi.fn() })
}))

const paneKey = makePaneKey('tab-question', '11111111-1111-4111-8111-111111111111')
const sessionId = '22222222-2222-4222-8222-222222222222'
const receipt = (accepted = true) => ({
  id: 'send',
  ok: true as const,
  result: { send: { accepted } },
  _meta: { runtimeId: 'fixture' }
})

describe('plain question ownership through Grok hooks and the real controller', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController
  let listener: ReturnType<typeof createHookListenerState>
  let server: AgentHookServer
  let status: AgentStatusEntry
  let inputLeaseReady: boolean
  const sendRequest = vi.fn()
  const onSendError = vi.fn()
  const client = { sendRequest } as unknown as RpcClient
  const handleRef = { current: 'terminal-question' }
  const deviceTokenRef = { current: 'fixture-device' }

  function ingest(payload: Record<string, unknown>): void {
    const event = normalizeHookPayload(
      listener,
      'grok',
      { paneKey, payload: { session_id: sessionId, ...payload } },
      'production'
    )!
    expect(event).not.toBeNull()
    listener.lastStatusByPaneKey.set(paneKey, event)
    server.ingestRemote(event, 'fixture-ssh-connection')
    status = server.getStatusSnapshot()[0]! as AgentStatusEntry
  }
  function question(name: string): void {
    ingest({ hook_event_name: 'stop', last_assistant_message: `Which ${name}?\n1. One\n2. Two` })
    ingest({ hook_event_name: 'notification', message: 'Needs your feedback on a question' })
  }
  function Harness(): null {
    controller = useMobileNativeChatController({
      client,
      connState: 'connected',
      hostId: 'question-host',
      worktreeId: 'question-worktree',
      activeSessionTab: { type: 'terminal', launchAgent: 'grok', agentStatus: status },
      activeSessionTabId: 'tab-question',
      activeHandleRef: handleRef,
      deviceTokenRef,
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: inputLeaseReady,
      onSendError,
      onSendResolved: vi.fn()
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
  function deferNextReceipt(): (accepted?: boolean) => void {
    let resolve!: (value: ReturnType<typeof receipt>) => void
    sendRequest.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    return (accepted = true) => resolve(receipt(accepted))
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetMobileNativeChatTerminalWritesForTests()
    sendRequest.mockResolvedValue(receipt())
    listener = createHookListenerState()
    server = new AgentHookServer()
    inputLeaseReady = true
    question('A')
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not send A body after B replaces its question during input clearing', async () => {
    await render()
    const scope = controller.nativeChatStreamScopeKey
    expect(controller.nativeChatQuestion?.question).toBe('Which A?')
    const resolve = deferNextReceipt()
    let result!: Promise<boolean>
    await act(async () => {
      result = controller.handleNativeChatQuestionAnswer('1')
    })
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['\u0015'])
    question('B')
    await render()
    expect(controller.nativeChatStreamScopeKey).toBe(scope)
    expect(controller.nativeChatQuestion?.question).toBe('Which B?')
    await act(async () => resolve())
    await expect(result).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).not.toHaveBeenCalled()
    await act(async () => {
      expect(await controller.handleNativeChatQuestionAnswer('2')).toBe(true)
    })
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['\u0015', '\u0015', '2'])
  })

  it('does not revive a detached A callback through A to B to A', async () => {
    await render()
    const answerA = controller.handleNativeChatQuestionAnswer
    question('B')
    await render()
    question('A')
    await render()
    await act(async () => {
      expect(await answerA('1')).toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    await act(async () => {
      expect(await controller.handleNativeChatQuestionAnswer('2')).toBe(true)
    })
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['\u0015', '2'])
  })

  it('does not report an old body rejection on the new question', async () => {
    await render()
    sendRequest.mockResolvedValueOnce(receipt())
    const resolve = deferNextReceipt()
    let result!: Promise<boolean>
    await act(async () => {
      result = controller.handleNativeChatQuestionAnswer('1')
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    question('B')
    await render()
    await act(async () => resolve(false))
    await expect(result).resolves.toBe(false)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('preserves the current answer during an unrelated refresh', async () => {
    await render()
    const resolve = deferNextReceipt()
    let result!: Promise<boolean>
    await act(async () => {
      result = controller.handleNativeChatQuestionAnswer('1')
    })
    ingest({ hook_event_name: 'notification', message: 'Needs your feedback on a question' })
    await render()
    await act(async () => resolve())
    await expect(result).resolves.toBe(true)
    expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual(['\u0015', '1'])
  })

  it.each([false, true])(
    'stops an unsent body after losing the lease (regained: %s)',
    async (regain) => {
      await render()
      const resolve = deferNextReceipt()
      let result!: Promise<boolean>
      await act(async () => {
        result = controller.handleNativeChatQuestionAnswer('1')
      })
      inputLeaseReady = false
      await render()
      if (regain) {
        inputLeaseReady = true
        await render()
      }
      await act(async () => resolve())
      await expect(result).resolves.toBe(false)
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(onSendError).not.toHaveBeenCalled()
    }
  )

  it('keeps a known final acceptance for the same question after losing the lease', async () => {
    await render()
    sendRequest.mockResolvedValueOnce(receipt())
    const resolve = deferNextReceipt()
    let result!: Promise<boolean>
    await act(async () => {
      result = controller.handleNativeChatQuestionAnswer('1')
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    inputLeaseReady = false
    await render()
    await act(async () => resolve())
    await expect(result).resolves.toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
  })
})
