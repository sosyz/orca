import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileTerminalPaste } from './use-mobile-terminal-paste'

const clipboard = vi.hoisted(() => ({ getStringAsync: vi.fn(), getImageAsync: vi.fn() }))
vi.mock('expo-clipboard', () => clipboard)
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'cache://' } }))
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { PNG: 'png' } }))
let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  clipboard.getStringAsync.mockReset().mockResolvedValue('hello')
  clipboard.getImageAsync.mockReset().mockResolvedValue(null)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function harness(response: unknown = { ok: true, result: { send: { accepted: true } } }) {
  const client = { sendRequest: vi.fn().mockResolvedValue(response) } as unknown as RpcClient
  const clientRef = { current: client as RpcClient | null }
  const connStateRef = { current: 'connected' as ConnectionState }
  const activeHandleRef = { current: 'terminal-1' as string | null }
  const onSuccess = vi.fn()
  const onError = vi.fn()
  const showToast = vi.fn()
  const flushPendingLiveInputBeforeExternalSend = vi.fn().mockResolvedValue(true)
  let paste!: () => Promise<void>
  function Probe() {
    paste = useMobileTerminalPaste({
      activeHandle: 'terminal-1',
      activeHandleRef,
      activeSessionTabTypeRef: { current: 'terminal' },
      canSend: true,
      client,
      clientRef,
      connState: 'connected',
      connStateRef,
      deviceTokenRef: { current: null },
      flushPendingLiveInputBeforeExternalSend,
      getActiveWorktreeConnectionId: async () => null,
      onSuccess,
      onError,
      ptyModesRef: { current: new Map() },
      refreshCanPaste: vi.fn(),
      showToast
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return {
    paste: () => paste(),
    client,
    clientRef,
    connStateRef,
    activeHandleRef,
    flushPendingLiveInputBeforeExternalSend,
    onSuccess,
    onError,
    showToast
  }
}

describe('terminal clipboard paste ownership and acknowledgement', () => {
  it.each([
    { ok: false, error: { code: 'input_lease_required', message: 'Input lease required' } },
    { ok: true, result: { send: { accepted: false } } },
    { ok: true, result: {} }
  ])('does not report success for a rejected paste: %j', async (response) => {
    const view = harness(response)
    await view.paste()
    expect(view.onSuccess).not.toHaveBeenCalled()
    expect(view.onError).toHaveBeenCalledOnce()
    expect(view.showToast).toHaveBeenCalledWith('Paste failed', 1500)
  })

  it('reports success only after the host accepts terminal input', async () => {
    const view = harness()
    await view.paste()
    expect(view.onSuccess).toHaveBeenCalledOnce()
    expect(view.onError).not.toHaveBeenCalled()
  })

  it.each(['client-change', 'unmount'])(
    'cancels a pending clipboard read on %s',
    async (change) => {
      let finishRead!: (text: string) => void
      clipboard.getStringAsync.mockReturnValue(
        new Promise<string>((resolve) => {
          finishRead = resolve
        })
      )
      const view = harness()
      const pasting = view.paste()
      const replacement = {
        sendRequest: vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
      } as unknown as RpcClient
      if (change === 'client-change') {
        view.clientRef.current = replacement
      } else {
        act(() => renderer?.unmount())
      }
      finishRead('old clipboard')
      await pasting
      expect(view.client.sendRequest).not.toHaveBeenCalled()
      expect(replacement.sendRequest).not.toHaveBeenCalled()
      expect(view.onSuccess).not.toHaveBeenCalled()
      expect(view.onError).not.toHaveBeenCalled()
    }
  )

  it.each(['client-change', 'unmount'])(
    'does not flush or send after an image upload finishes on %s',
    async (change) => {
      clipboard.getStringAsync.mockResolvedValue('')
      clipboard.getImageAsync.mockResolvedValue({
        data: 'aGVsbG8=',
        size: { width: 1, height: 1 }
      })
      const view = harness()
      let resolveCommit!: (response: { ok: true; result: string }) => void
      let commitStarted!: () => void
      const started = new Promise<void>((resolve) => {
        commitStarted = resolve
      })
      const sendRequest = view.client.sendRequest as ReturnType<typeof vi.fn>
      sendRequest.mockImplementation((method: string) => {
        if (method === 'clipboard.startImageUpload') {
          return Promise.resolve({ ok: true, result: { uploadId: 'upload-1' } })
        }
        if (method === 'clipboard.appendImageUploadChunk') {
          return Promise.resolve({ ok: true, result: {} })
        }
        if (method === 'clipboard.commitImageUpload') {
          commitStarted()
          return new Promise((resolve) => {
            resolveCommit = resolve
          })
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
      const pasting = view.paste()
      await started
      if (change === 'client-change') {
        view.clientRef.current = { sendRequest: vi.fn() } as unknown as RpcClient
      } else {
        act(() => renderer?.unmount())
      }
      resolveCommit({ ok: true, result: '/tmp/image.png' })
      await pasting
      expect(view.flushPendingLiveInputBeforeExternalSend).not.toHaveBeenCalled()
      expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('terminal.send')
      expect(view.onSuccess).not.toHaveBeenCalled()
      expect(view.onError).not.toHaveBeenCalled()
    }
  )
})
