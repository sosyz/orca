import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  appendMobileNativeChatAttachments,
  clearMobileNativeChatRuntimeStoreForTests,
  ensureMobileNativeChatRuntimeScope
} from './mobile-native-chat-runtime-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'

vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImages: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

const SCOPE = 'host\0workspace\0tab'

describe('native-chat image caption bytes', () => {
  let renderer: ReactTestRenderer | null = null
  let attachments: ReturnType<typeof useMobileNativeChatImageAttachments>
  const sendRequest = vi.fn()
  const baseSend = vi.fn()

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    sendRequest.mockReset().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    baseSend.mockReset().mockResolvedValue('accepted')
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    clearMobileNativeChatRuntimeStoreForTests()
  })

  function Harness(): null {
    attachments = useMobileNativeChatImageAttachments({
      client: { sendRequest } as unknown as RpcClient,
      activeHandleRef: { current: 'terminal' },
      deviceTokenRef: { current: null },
      getActiveWorktreeConnectionId: async () => null,
      connState: 'connected',
      scopeKey: SCOPE,
      enabled: true,
      showToast: vi.fn(),
      onSendError: vi.fn(),
      baseSend,
      readSeededLaunchDraft: () => null,
      sleep: async () => {}
    })
    return null
  }

  it.each([
    { paths: ['/tmp/a.png'], caption: 'describe', separator: ' ' },
    { paths: ['/tmp/a.png', '/tmp/b.png'], caption: 'describe', separator: ' ' },
    { paths: ['/tmp/a.png'], caption: '', separator: '' },
    { paths: ['/tmp/a.png'], caption: ' \n ', separator: '' },
    { paths: ['/tmp/a.png', '/tmp/b.png'], caption: '\t', separator: '' }
  ])(
    'separates $paths from caption $caption only when text follows',
    async ({ paths, caption, separator }) => {
      const scope = ensureMobileNativeChatRuntimeScope(SCOPE)
      const previews = paths.map((path) => `file://${path}`)
      appendMobileNativeChatAttachments(
        { scopeKey: SCOPE, generation: scope.generation },
        paths.map((path, index) => ({ path, previewUri: previews[index]! }))
      )
      act(() => {
        renderer = create(createElement(Harness))
      })
      await act(async () => {
        expect(await attachments.sendNativeChat(caption)).toBe(true)
      })

      expect(sendRequest.mock.calls.map((call) => call[1].text)).toEqual([
        '\x15',
        ...paths.map(
          (path, index) => `\x1b[200~${path}\x1b[201~${index === paths.length - 1 ? separator : ''}`
        )
      ])
      expect(baseSend).toHaveBeenCalledWith(caption, previews, expect.any(Number))
      expect(attachments.attachments).toEqual([])
    }
  )
})
