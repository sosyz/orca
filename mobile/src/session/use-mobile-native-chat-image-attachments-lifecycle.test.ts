import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import { closeMobileSessionTabIfCurrent } from './mobile-session-tab-close'
import {
  clearMobileNativeChatRuntimeStoreForTests,
  purgeMobileNativeChatRuntimeScope,
  readMobileNativeChatAttachments
} from './mobile-native-chat-runtime-store'
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function clipboardClient(methods: string[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string) => {
      methods.push(method)
      if (method === 'session.tabs.close') {
        return ok('close', {})
      }
      if (method === 'clipboard.startImageUpload') {
        return methodNotFound('start')
      }
      if (method === 'clipboard.saveImageAsTempFile') {
        return ok('save', '/tmp/a.png')
      }
      throw new Error(`unexpected request: ${method}`)
    })
  } as unknown as RpcClient
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

  it('does not upload or report success after the initiating tab closes while picker is open', async () => {
    const selection = deferred<Array<{ base64: string; uri: string }>>()
    pick.mockReturnValue(selection.promise as never)
    const methods: string[] = []
    const client = clipboardClient(methods)
    const onAttachSuccess = vi.fn()
    const onError = vi.fn()
    const showToast = vi.fn()
    const args = { ...baseArgs(client), onAttachSuccess, onError, showToast }
    mount(args)

    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    expect(
      await closeMobileSessionTabIfCurrent({
        client,
        worktreeId: 'w',
        tabId: 'tab-a',
        isCurrent: () => true
      })
    ).toBe(true)
    purgeMobileNativeChatRuntimeScope(SCOPE_A)
    update({ ...args, scopeKey: SCOPE_B })

    selection.resolve([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    await act(async () => {
      await attaching
    })
    expect(methods).toEqual(['session.tabs.close'])
    expect(readMobileNativeChatAttachments(SCOPE_A)).toEqual([])
    expect(hook!.attachments).toEqual([])
    expect(onAttachSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('does not open the picker from a callback whose tab has already retired', async () => {
    const methods: string[] = []
    mount(baseArgs(clipboardClient(methods)))
    const attachFromTabA = hook!.attachImage
    act(() => purgeMobileNativeChatRuntimeScope(SCOPE_A))

    await act(async () => {
      await attachFromTabA('library')
    })
    expect(pick).not.toHaveBeenCalled()
    expect(methods).toEqual([])
  })

  it('stops a multi-image selection before uploading its next image after tab retirement', async () => {
    const nextImage = deferred<void>()
    const methods: string[] = []
    const client = clipboardClient(methods)
    const onAttachSuccess = vi.fn()
    pick.mockReturnValue(
      (async function* () {
        yield { base64: 'AAAA', uri: 'file:///first.jpg' }
        await nextImage.promise
        yield { base64: 'BBBB', uri: 'file:///second.jpg' }
      })()
    )
    mount({ ...baseArgs(client), onAttachSuccess })

    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    await vi.waitFor(() =>
      expect(methods).toEqual(['clipboard.startImageUpload', 'clipboard.saveImageAsTempFile'])
    )
    purgeMobileNativeChatRuntimeScope(SCOPE_A)
    nextImage.resolve()
    await act(async () => {
      await attaching
    })

    expect(methods).toEqual(['clipboard.startImageUpload', 'clipboard.saveImageAsTempFile'])
    expect(readMobileNativeChatAttachments(SCOPE_A)).toEqual([])
    expect(onAttachSuccess).not.toHaveBeenCalled()
  })

  it('does not retry a cutover upload after the initiating tab retires', async () => {
    const methods: string[] = []
    const onAttachSuccess = vi.fn()
    const onError = vi.fn()
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        methods.push(method)
        if (method === 'clipboard.startImageUpload') {
          return ok('start', { uploadId: 'upload-1' })
        }
        if (method === 'clipboard.appendImageUploadChunk') {
          purgeMobileNativeChatRuntimeScope(SCOPE_A)
          throw new LogicalClientCutoverError()
        }
        if (method === 'clipboard.abortImageUpload') {
          return ok('abort', { aborted: true })
        }
        throw new Error(`unexpected request: ${method}`)
      })
    } as unknown as RpcClient
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    mount({ ...baseArgs(client), onAttachSuccess, onError })

    await act(async () => {
      await hook!.attachImage('library')
    })

    expect(methods).toEqual([
      'clipboard.startImageUpload',
      'clipboard.appendImageUploadChunk',
      'clipboard.abortImageUpload'
    ])
    expect(readMobileNativeChatAttachments(SCOPE_A)).toEqual([])
    expect(onAttachSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not append a chunk after a pending upload start resolves for a retired tab', async () => {
    const start = deferred<RpcResponse>()
    const methods: string[] = []
    const onAttachSuccess = vi.fn()
    const sendRequest = vi.fn(async (method: string) => {
      methods.push(method)
      if (method === 'clipboard.startImageUpload') {
        return start.promise
      }
      if (method === 'clipboard.abortImageUpload') {
        return ok('abort', { aborted: true })
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const client = { sendRequest } as unknown as RpcClient
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    mount({ ...baseArgs(client), onAttachSuccess })
    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    await vi.waitFor(() => expect(methods).toEqual(['clipboard.startImageUpload']))
    act(() => purgeMobileNativeChatRuntimeScope(SCOPE_A))
    start.resolve(ok('start', { uploadId: 'upload-1' }))

    await act(async () => {
      await attaching
    })
    expect(methods).toEqual(['clipboard.startImageUpload', 'clipboard.abortImageUpload'])
    expect(sendRequest).toHaveBeenCalledWith(
      'clipboard.abortImageUpload',
      {
        uploadId: 'upload-1'
      },
      undefined
    )
    expect(onAttachSuccess).not.toHaveBeenCalled()
  })

  it('does not start upload after a connection lookup resolves for a retired tab', async () => {
    const connection = deferred<string | null>()
    const methods: string[] = []
    const onAttachSuccess = vi.fn()
    const client = clipboardClient(methods)
    const getActiveWorktreeConnectionId = vi.fn(() => connection.promise)
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    mount({ ...baseArgs(client), getActiveWorktreeConnectionId, onAttachSuccess })
    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    await vi.waitFor(() => expect(getActiveWorktreeConnectionId).toHaveBeenCalledTimes(1))
    act(() => purgeMobileNativeChatRuntimeScope(SCOPE_A))
    connection.resolve(null)

    await act(async () => {
      await attaching
    })
    expect(methods).toEqual([])
    expect(onAttachSuccess).not.toHaveBeenCalled()
  })

  it('continues an in-flight pick into its original scope when another tab becomes active', async () => {
    const selection = deferred<Array<{ base64: string; uri: string }>>()
    pick.mockReturnValue(selection.promise as never)
    const methods: string[] = []
    const client = clipboardClient(methods)
    const onAttachSuccess = vi.fn()
    const args = { ...baseArgs(client), onAttachSuccess }
    mount(args)
    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    update({ ...args, scopeKey: SCOPE_B })

    selection.resolve([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    await act(async () => {
      await attaching
    })
    expect(methods).toEqual(['clipboard.startImageUpload', 'clipboard.saveImageAsTempFile'])
    expect(readMobileNativeChatAttachments(SCOPE_A).map((image) => image.previewUri)).toEqual([
      'file:///a.jpg'
    ])
    expect(hook!.attachments).toEqual([])
    expect(onAttachSuccess).toHaveBeenCalledTimes(1)
  })

  it('keeps a valid-scope upload after its composer unmounts', async () => {
    const selection = deferred<Array<{ base64: string; uri: string }>>()
    pick.mockReturnValue(selection.promise as never)
    const methods: string[] = []
    const client = clipboardClient(methods)
    mount(baseArgs(client))
    let attaching!: Promise<void>
    act(() => {
      attaching = hook!.attachImage('library')
    })
    act(() => renderer!.unmount())
    renderer = null
    selection.resolve([{ base64: 'AAAA', uri: 'file:///a.jpg' }])

    await act(async () => {
      await attaching
    })
    expect(methods).toEqual(['clipboard.startImageUpload', 'clipboard.saveImageAsTempFile'])
    expect(readMobileNativeChatAttachments(SCOPE_A).map((image) => image.previewUri)).toEqual([
      'file:///a.jpg'
    ])
  })
})
