import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'
import {
  appendMobileNativeChatAttachments,
  clearMobileNativeChatRuntimeStoreForTests,
  ensureMobileNativeChatRuntimeScope,
  readMobileNativeChatUnconfirmedSends
} from './mobile-native-chat-runtime-store'
import {
  isMobileNativeChatInputStale,
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImages: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const accepted = { ok: true, result: { send: { accepted: true } } }
const SCOPE = 'host\0workspace\0tab'
const messages: NativeChatMessage[] = []

describe('Stop during a native-chat composer send', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts>
  let images: ReturnType<typeof useMobileNativeChatImageAttachments>
  let stop: () => void
  const handleRef = { current: 'terminal' }
  const deviceTokenRef = { current: 'device' }
  const sendRequest = vi.fn()
  const onSendError = vi.fn()
  const sleep = vi.fn()
  const client = { sendRequest } as unknown as RpcClient

  function Harness(): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'workspace',
      tabId: 'tab',
      sessionId: 'session',
      messages,
      transcriptSettled: true
    })
    const sending = useMobileNativeChatMessageSend({
      ...drafts,
      client,
      enabled: true,
      handleRef,
      deviceTokenRef,
      agentRef: { current: 'claude' },
      commandSendRef: { current: vi.fn() },
      onSendError
    })
    images = useMobileNativeChatImageAttachments({
      client,
      activeHandleRef: handleRef,
      deviceTokenRef,
      getActiveWorktreeConnectionId: async () => null,
      connState: 'connected',
      scopeKey: SCOPE,
      enabled: true,
      showToast: vi.fn(),
      onSendError,
      baseSend: sending.sendWithOutcome,
      readSeededLaunchDraft: () => null,
      sleep
    })
    stop = useMobileNativeChatStop({
      client,
      enabled: true,
      handleRef,
      deviceTokenRef,
      streamIdentity: 'stream',
      cancelPending: vi.fn(),
      onSendError
    })
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    clearMobileNativeChatRuntimeStoreForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    sendRequest.mockReset().mockResolvedValue(accepted)
    onSendError.mockReset()
    sleep.mockReset().mockResolvedValue(undefined)
    handleRef.current = 'terminal'
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    clearMobileNativeChatRuntimeStoreForTests()
    vi.useRealTimers()
  })

  async function mount(withImages: boolean): Promise<void> {
    const scope = ensureMobileNativeChatRuntimeScope(SCOPE)
    if (withImages) {
      appendMobileNativeChatAttachments({ scopeKey: SCOPE, generation: scope.generation }, [
        { path: '/tmp/a.png', previewUri: 'file:///a.png' },
        { path: '/tmp/b.png', previewUri: 'file:///b.png' }
      ])
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    act(() => drafts.setComposerText('original message'))
  }

  it.each(['heal', 'pre-clear', 'image paste', 'image settle'] as const)(
    'keeps the draft and attachments when Stop interrupts %s before submission',
    async (stage) => {
      const gate = deferred<void>()
      const withImages = stage.startsWith('image')
      let blocked = false
      if (stage === 'heal') {
        markMobileNativeChatInputStale('terminal')
      }
      if (stage === 'image settle') {
        sleep.mockImplementationOnce(() => {
          blocked = true
          return gate.promise
        })
      } else {
        sendRequest.mockImplementation(async (_method, params: { text: string }) => {
          if (
            !blocked &&
            (stage === 'image paste' ? params.text.includes('[200~') : params.text === '\x15')
          ) {
            blocked = true
            await gate.promise
          }
          return accepted
        })
      }
      await mount(withImages)
      let pending!: Promise<boolean>
      await act(async () => {
        pending = images.sendNativeChat('original message')
      })
      expect(blocked).toBe(true)
      act(() => stop())
      await act(async () => vi.advanceTimersByTimeAsync(80))
      await act(async () => {
        gate.resolve()
        await pending
      })

      await expect(pending).resolves.toBe(false)
      expect(sendRequest.mock.calls.filter((call) => call[1].enter === true)).toEqual([])
      expect(drafts.composerText).toBe('original message')
      expect(images.attachments).toHaveLength(withImages ? 2 : 0)
      if (withImages) {
        expect(isMobileNativeChatInputStale('terminal')).toBe(true)
      }
      expect(onSendError).not.toHaveBeenCalled()
    }
  )

  it('does not let a completed Stop cancel a later send', async () => {
    const gate = deferred<void>()
    sleep.mockReturnValueOnce(gate.promise)
    await mount(true)
    let oldSend!: Promise<boolean>
    await act(async () => {
      oldSend = images.sendNativeChat('original message')
    })
    act(() => stop())
    await act(async () => vi.advanceTimersByTimeAsync(80))
    await act(async () => {
      gate.resolve()
      await oldSend
    })
    await expect(oldSend).resolves.toBe(false)

    act(() => drafts.setComposerText('next message'))
    await act(async () => {
      expect(await images.sendNativeChat('next message')).toBe(true)
    })
    expect(
      sendRequest.mock.calls.filter((call) => call[1].enter === true).map((call) => call[1].text)
    ).toEqual(['next message'])
    expect(images.attachments).toEqual([])
    expect(drafts.composerText).toBe('')
  })

  it('keeps new input while an older Stop is still writing Escapes, then allows retry', async () => {
    const pasteGate = deferred<void>()
    const escapeGate = deferred<void>()
    sleep.mockReturnValueOnce(pasteGate.promise)
    sendRequest.mockImplementation(async (_method, params: { text: string }) => {
      if (params.text === '\x1b') {
        await escapeGate.promise
      }
      return accepted
    })
    await mount(true)
    let oldSend!: Promise<boolean>
    await act(async () => {
      oldSend = images.sendNativeChat('original message')
    })
    act(() => stop())
    await act(async () => {
      pasteGate.resolve()
      await oldSend
    })
    expect(await oldSend).toBe(false)

    act(() => drafts.setComposerText('next message'))
    await act(async () => {
      expect(await images.sendNativeChat('next message')).toBe(false)
    })
    expect(drafts.composerText).toBe('next message')
    expect(images.attachments).toHaveLength(2)
    expect(sendRequest.mock.calls.filter((call) => call[1].enter === true)).toEqual([])

    await act(async () => vi.advanceTimersByTimeAsync(80))
    await act(async () => {
      expect(await images.sendNativeChat('next message')).toBe(false)
    })
    await act(async () => {
      escapeGate.resolve()
    })
    await act(async () => {
      expect(await images.sendNativeChat('next message')).toBe(true)
    })
    expect(
      sendRequest.mock.calls.filter((call) => call[1].enter === true).map((call) => call[1].text)
    ).toEqual(['next message'])
    expect(drafts.composerText).toBe('')
    expect(images.attachments).toEqual([])
  })

  it.each(['accepted', 'unknown'] as const)(
    "preserves an already dispatched message's %s outcome after Stop",
    async (outcome) => {
      const bodyGate = deferred<void>()
      sendRequest.mockImplementation(async (_method, params: { enter?: boolean }) => {
        if (params.enter) {
          await bodyGate.promise
          if (outcome === 'unknown') {
            throw markRpcDeliveryUnknown(new Error('ack lost'))
          }
        }
        return accepted
      })
      await mount(true)
      let pending!: Promise<boolean>
      await act(async () => {
        pending = images.sendNativeChat('original message')
      })
      expect(sendRequest.mock.calls.filter((call) => call[1].enter === true)).toHaveLength(1)
      act(() => stop())
      await act(async () => vi.advanceTimersByTimeAsync(80))
      await act(async () => {
        bodyGate.resolve()
        await pending
      })

      expect(await pending).toBe(true)
      expect(drafts.composerText).toBe('')
      expect(images.attachments).toEqual([])
      expect(drafts.pending).toHaveLength(outcome === 'accepted' ? 1 : 0)
      expect(readMobileNativeChatUnconfirmedSends(SCOPE)).toHaveLength(
        outcome === 'unknown' ? 1 : 0
      )
      expect(onSendError).not.toHaveBeenCalled()
      expect(sendRequest.mock.calls.filter((call) => call[1].enter === true)).toHaveLength(1)
    }
  )
})
