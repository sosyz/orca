import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { clearMobileNativeChatRuntimeStoreForTests } from './mobile-native-chat-runtime-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImages: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

import { pickMobileImages } from './mobile-image-source-picker'

const pick = vi.mocked(pickMobileImages)
const SCOPE_A = 'h\0w\0tab-a'
const SCOPE_B = 'h\0w\0tab-b'

function ok(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'r' } }
}

function methodNotFound(id: string): RpcResponse {
  return {
    id,
    ok: false,
    error: { code: 'method_not_found', message: 'no' },
    _meta: { runtimeId: 'r' }
  }
}

type HookArgs = Parameters<typeof useMobileNativeChatImageAttachments>[0]
type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>

function baseArgs(client: RpcClient): HookArgs {
  return {
    client,
    activeHandleRef: { current: 'term-1' },
    deviceTokenRef: { current: null },
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    scopeKey: SCOPE_A,
    enabled: true,
    showToast: vi.fn(),
    onSendError: vi.fn(),
    baseSend: vi.fn().mockResolvedValue('accepted'),
    readSeededLaunchDraft: () => null,
    sleep: async () => {}
  }
}

describe('useMobileNativeChatImageAttachments lifecycle', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    pick.mockReset()
    clearMobileNativeChatRuntimeStoreForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    clearMobileNativeChatRuntimeStoreForTests()
  })

  function mount(args: HookArgs): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }

  function update(args: HookArgs): void {
    act(() => {
      renderer!.update(createElement(Harness, { args }))
    })
  }

  it('keeps unsent native-chat chips across remounts without leaking to another scope', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const responses = [methodNotFound('start'), ok('save', '/tmp/a.png')]
    const client = {
      sendRequest: vi.fn(async () => responses.shift()!)
    } as unknown as RpcClient
    const args = baseArgs(client)
    mount(args)

    await act(async () => {
      await hook!.attachImage('library')
    })
    expect(hook!.attachments.map((image) => image.previewUri)).toEqual(['file:///a.jpg'])

    act(() => renderer!.unmount())
    renderer = null
    mount({ ...args, scopeKey: SCOPE_B })
    expect(hook!.attachments).toEqual([])

    update(args)
    expect(hook!.attachments.map((image) => image.previewUri)).toEqual(['file:///a.jpg'])
  })
})
