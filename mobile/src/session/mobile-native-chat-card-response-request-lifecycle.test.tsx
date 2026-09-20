import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../../../src/main/agent-hooks/server'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { makePaneKey } from '../../../src/shared/stable-pane-id'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ ShieldQuestion: 'ShieldQuestion' }))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({
    messages: [] as NativeChatMessage[],
    status: 'ready',
    transcriptLoading: false
  })
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
const accepted = () => ({
  id: 'send',
  ok: true as const,
  result: { send: { accepted: true } },
  _meta: { runtimeId: 'fixture' }
})
const rejected = () => ({ ...accepted(), result: { send: { accepted: false } } })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('native-chat card response request ownership through the real controller', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController
  let listener: ReturnType<typeof createHookListenerState>
  let server: AgentHookServer
  let status: AgentStatusEntry
  let hostId: string
  let tabId: string
  let currentClient: RpcClient
  let leaseReady: boolean
  let heldError: string | null = null
  const sendRequest = vi.fn()
  const onSendError = vi.fn((message: string) => {
    heldError = message
  })
  const onSendResolved = vi.fn(() => {
    heldError = null
  })
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
  function permission(toolUseId: string): void {
    ingest({
      hook_event_name: 'PermissionRequest',
      tool_use_id: toolUseId,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' }
    })
  }
  function ask(toolUseId: string): void {
    ingest({
      hook_event_name: 'PreToolUse',
      agent_id: toolUseId,
      tool_use_id: toolUseId,
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          { question: `Continue ${toolUseId}?`, options: [{ label: 'Yes' }, { label: 'No' }] }
        ]
      }
    })
  }
  function Harness(): React.JSX.Element | null {
    controller = useMobileNativeChatController({
      client: currentClient,
      connState: 'connected',
      hostId,
      worktreeId: 'worktree-1',
      activeSessionTab: { type: 'terminal', launchAgent: 'claude', agentStatus: status },
      activeSessionTabId: tabId,
      activeHandleRef: handleRef,
      deviceTokenRef,
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: leaseReady,
      onSendError,
      onSendResolved
    })
    return controller.nativeChatPermission
      ? createElement(MobileNativeChatPermission, {
          key: controller.nativeChatPermissionKey,
          permission: controller.nativeChatPermission,
          onRespond: controller.handleNativeChatRespondPermission
        })
      : null
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

  beforeEach(() => {
    vi.clearAllMocks()
    sendRequest.mockReset()
    resetMobileNativeChatTerminalWritesForTests()
    heldError = null
    hostId = 'host-1'
    tabId = 'tab-1'
    currentClient = client
    leaseReady = true
    listener = createHookListenerState()
    server = new AgentHookServer()
    ingest({ hook_event_name: 'UserPromptSubmit', prompt: 'run tests' })
    sendRequest.mockResolvedValue(accepted())
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['rejected', 'unknown'])(
    'ignores permission A’s late %s on request B',
    async (outcome) => {
      permission('tool-a')
      await render()
      const requestA = controller.nativeChatInteractionRequestKey
      expect(controller.nativeChatPermission?.options[0]?.send).toBe('1')
      const first = deferred<ReturnType<typeof accepted>>()
      sendRequest.mockReturnValueOnce(first.promise)
      let result!: Promise<boolean>
      act(() => {
        result = controller.handleNativeChatRespondPermission('1')
      })
      permission('tool-b')
      await render()
      expect(controller.nativeChatInteractionRequestKey).not.toBe(requestA)
      expect(controller.nativeChatPermission).not.toBeNull()

      await act(async () => {
        if (outcome === 'unknown') {
          first.reject(markRpcDeliveryUnknown(new Error('ack lost')))
        } else {
          first.resolve(rejected())
        }
        await result
      })
      expect(onSendError).not.toHaveBeenCalled()
      expect(onSendResolved).not.toHaveBeenCalled()
    }
  )

  it('does not let permission A’s accepted receipt clear B’s newer error', async () => {
    permission('tool-a')
    await render()
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    let oldResult!: Promise<boolean>
    act(() => {
      oldResult = controller.handleNativeChatRespondPermission('1')
    })
    permission('tool-b')
    await render()
    await act(async () => {
      expect(await controller.handleNativeChatRespondPermission('1')).toBe(false)
    })
    expect(heldError).toBe('Response not sent')

    await act(async () => {
      first.resolve(accepted())
      await oldResult
    })
    expect(heldError).toBe('Response not sent')
    expect(onSendResolved).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'keeps the same permission submitted when its accepted receipt follows a lease drop (restored: %s)',
    async (restoreLease) => {
      permission('tool-a')
      await render()
      const key = controller.nativeChatPermissionKey
      const choice = () => renderer!.root.findAllByType('Pressable')[0]!
      const first = deferred<ReturnType<typeof accepted>>()
      sendRequest.mockReturnValueOnce(first.promise)
      act(() => {
        void choice().props.onPress()
      })
      expect(choice().props.disabled).toBe(true)

      leaseReady = false
      await render()
      expect(controller.nativeChatPermissionKey).toBe(key)
      if (restoreLease) {
        leaseReady = true
        await render()
        expect(controller.nativeChatPermissionKey).toBe(key)
      }
      await act(async () => first.resolve(accepted()))
      expect(choice().props.disabled).toBe(true)
      expect(onSendResolved).toHaveBeenCalledOnce()
    }
  )

  it.each(['host', 'tab', 'client'])(
    'retiring and returning to the same %s source does not revive an old permission receipt',
    async (change) => {
      permission('tool-a')
      await render()
      const first = deferred<ReturnType<typeof accepted>>()
      sendRequest.mockReturnValueOnce(first.promise)
      let oldResult!: Promise<boolean>
      act(() => {
        oldResult = controller.handleNativeChatRespondPermission('1')
      })

      if (change === 'host') {
        hostId = 'host-2'
      }
      if (change === 'tab') {
        tabId = 'tab-2'
      }
      if (change === 'client') {
        currentClient = { sendRequest: vi.fn() } as unknown as RpcClient
      }
      await render()
      hostId = 'host-1'
      tabId = 'tab-1'
      currentClient = client
      await render()

      await act(async () => {
        first.resolve(accepted())
        expect(await oldResult).toBe(false)
      })
      expect(onSendResolved).not.toHaveBeenCalled()
      expect(onSendError).not.toHaveBeenCalled()
    }
  )

  it('a detached permission callback cannot send into the next source', async () => {
    permission('tool-a')
    await render()
    const oldRespond = controller.handleNativeChatRespondPermission
    hostId = 'host-2'
    await render()
    await act(async () => {
      expect(await oldRespond('1')).toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('keeps a permission receipt owner through first-known, missing and repeated request IDs', async () => {
    permission('tool-a')
    const requestId = status.interactiveRequestKey
    status = { ...status, interactiveRequestKey: undefined }
    await render()
    const key = controller.nativeChatPermissionKey
    expect(key).not.toBeNull()
    status = { ...status, interactiveRequestKey: requestId }
    await render()
    expect(controller.nativeChatPermissionKey).toBe(key)
    status = { ...status, interactiveRequestKey: undefined }
    await render()
    expect(controller.nativeChatPermissionKey).toBe(key)
    status = { ...status, interactiveRequestKey: requestId }
    await render()
    expect(controller.nativeChatPermissionKey).toBe(key)

    await act(async () => {
      expect(await controller.handleNativeChatRespondPermission('1')).toBe(true)
    })
    expect(onSendResolved).toHaveBeenCalledTimes(1)
  })

  it.each(['rejected', 'unknown'])(
    'ignores ask cancel A’s late %s on request B',
    async (outcome) => {
      ask('ask-a')
      await render()
      const askKeyA = controller.nativeChatAskKey
      expect(controller.nativeChatAsk).not.toBeNull()
      const first = deferred<ReturnType<typeof accepted>>()
      sendRequest.mockReturnValueOnce(first.promise)
      let result!: Promise<boolean>
      act(() => {
        result = controller.handleNativeChatCancelAsk()
      })
      ask('ask-b')
      await render()
      expect(controller.nativeChatAskKey).not.toBe(askKeyA)
      expect(controller.nativeChatAsk).not.toBeNull()

      await act(async () => {
        if (outcome === 'unknown') {
          first.reject(markRpcDeliveryUnknown(new Error('ack lost')))
        } else {
          first.resolve(rejected())
        }
        await result
      })
      expect(onSendError).not.toHaveBeenCalled()
      expect(onSendResolved).not.toHaveBeenCalled()
    }
  )

  it('does not let ask cancel A’s accepted receipt clear B’s newer error', async () => {
    ask('ask-a')
    await render()
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    let oldResult!: Promise<boolean>
    act(() => {
      oldResult = controller.handleNativeChatCancelAsk()
    })
    ask('ask-b')
    await render()
    sendRequest.mockResolvedValueOnce(rejected())
    await act(async () => {
      expect(await controller.handleNativeChatCancelAsk()).toBe(false)
    })
    expect(heldError).toBe('Cancel not sent')

    await act(async () => {
      first.resolve(accepted())
      await oldResult
    })
    expect(heldError).toBe('Cancel not sent')
    expect(onSendResolved).not.toHaveBeenCalled()
  })

  it('an ask cancel receipt stays retired after a same-request host ABA', async () => {
    ask('ask-a')
    await render()
    const askKey = controller.nativeChatAskKey
    const first = deferred<ReturnType<typeof accepted>>()
    sendRequest.mockReturnValueOnce(first.promise)
    let oldResult!: Promise<boolean>
    act(() => {
      oldResult = controller.handleNativeChatCancelAsk()
    })
    hostId = 'host-2'
    await render()
    hostId = 'host-1'
    await render()
    expect(controller.nativeChatAskKey).toBe(askKey)

    await act(async () => {
      first.resolve(accepted())
      expect(await oldResult).toBe(false)
    })
    expect(onSendResolved).not.toHaveBeenCalled()
  })
})
