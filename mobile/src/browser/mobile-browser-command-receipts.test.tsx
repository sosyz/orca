import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileBrowserCommands } from './use-mobile-browser-commands'
import { useMobileBrowserRequest } from './use-mobile-browser-request'

const success = { ok: true, result: {} }
const unsupported = { ok: false, error: { code: 'method_not_found', message: 'Unknown method' } }
function deferred() {
  let resolve!: (response: unknown) => void
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('mobile browser command receipts', () => {
  let renderer: ReactTestRenderer | null = null
  let commands: ReturnType<typeof useMobileBrowserCommands>
  let error: string | null
  let keyboardText: string
  let request: ReturnType<typeof useMobileBrowserRequest>['sendBrowserRequest']

  function Harness({ client, page = 'page-a' }: { client: RpcClient; page?: string }): null {
    const busyRef = useRef(false)
    const frameMetadataRef = useRef({ deviceWidth: 100, deviceHeight: 100, pageScaleFactor: 1 })
    const layoutRef = useRef({ width: 100, height: 100 })
    const zoomRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 })
    const [, setBusy] = useState(false)
    const [commandError, setError] = useState<string | null>(null)
    const [keyboardValue, setKeyboardValue] = useState('')
    const [pointerModifiers, setPointerModifiers] = useState<('shift' | 'ctrl' | 'alt' | 'cmd')[]>(
      []
    )
    const [, setDialog] = useState<{ dialogType: string; message: string } | null>(null)
    const { pageParams, sendBrowserRequest } = useMobileBrowserRequest({
      busyRef,
      client,
      commandFailedMessage: 'Command failed',
      pageId: page,
      setBusy,
      setError,
      worktreeId: 'worktree'
    })
    commands = useMobileBrowserCommands({
      active: true,
      client,
      frameMetadataRef,
      keyboardValue,
      layoutRef,
      onToast: vi.fn(),
      pageParams,
      pageInputActive: true,
      pointerModifiers,
      sendBrowserRequest,
      setDialog,
      setError,
      setKeyboardValue,
      setPointerModifiers,
      toasts: { rightClick: 'Right click', sent: 'Sent' },
      zoomRef
    })
    error = commandError
    keyboardText = keyboardValue
    request = sendBrowserRequest
    return null
  }
  async function render(client: RpcClient, page = 'page-a') {
    await act(async () => {
      const element = createElement(Harness, { client, page })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not replay an accepted older click after a second click starts', async () => {
    const a = deferred(),
      b = deferred()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    let first!: Promise<void>, second!: Promise<void>
    act(() => {
      first = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
      second = commands.sendPointerClick({ x: 80, y: 80 }, 'left')
    })
    await act(async () => {
      b.resolve(success)
      await second
      a.resolve(success)
      await first
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'browser.mouseClick',
      'browser.mouseClick'
    ])
  })

  it.each([
    ['timeout', new Error('RPC timed out')],
    ['unknown delivery', markRpcDeliveryUnknown(new Error('ack lost'))]
  ])('does not replay a click after %s', async (_name, failure) => {
    const sendRequest = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    await act(async () => commands.sendPointerClick({ x: 20, y: 20 }, 'left'))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(error).toBe((failure as Error).message)
  })

  it('does not replay a supported method failure', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'internal_error', message: 'Pointer dispatch failed' }
      })
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    await act(async () => commands.sendPointerClick({ x: 20, y: 20 }, 'left'))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(error).toBe('Pointer dispatch failed')
  })

  it('preserves the legacy fallback only for explicit method_not_found', async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce(unsupported).mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    await act(async () => commands.sendPointerClick({ x: 20, y: 20 }, 'left'))
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'browser.mouseClick',
      'browser.mouseMove',
      'browser.mouseDown',
      'browser.mouseUp'
    ])
    expect(error).toBeNull()
  })

  it('clears an earlier error when the latest legacy click succeeds', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'internal_error', message: 'Earlier failure' }
      })
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    await act(async () => request('browser.goto'))
    expect(error).toBe('Earlier failure')
    await act(async () => commands.sendPointerClick({ x: 20, y: 20 }, 'left'))
    expect(error).toBeNull()
  })

  it.each(['legacy click', 'wheel'])(
    'does not let an older %s success clear a newer same-page error',
    async (kind) => {
      const accepted = deferred()
      const sendRequest = vi.fn((method: string) => {
        if (method === 'browser.mouseClick') {
          return Promise.resolve(unsupported)
        }
        if (method === 'browser.mouseUp' || method === 'browser.mouseWheel') {
          return accepted.promise
        }
        if (method === 'browser.goto') {
          return Promise.resolve({
            ok: false,
            error: { code: 'internal_error', message: 'B failed' }
          })
        }
        return Promise.resolve(success)
      })
      await render({ sendRequest } as unknown as RpcClient)
      let pending: Promise<void> | undefined
      await act(async () => {
        if (kind === 'legacy click') {
          pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
        } else {
          commands.sendWheel({ x: 20, y: 20 }, 10, 10, 1)
        }
      })
      expect(sendRequest.mock.calls.at(-1)?.[0]).toBe(
        kind === 'legacy click' ? 'browser.mouseUp' : 'browser.mouseWheel'
      )
      await act(async () => request('browser.goto'))
      expect(error).toBe('B failed')
      await act(async () => {
        accepted.resolve(success)
        await pending
      })
      expect(error).toBe('B failed')
    }
  )

  it('does not execute an old unsupported click after a newer click completed', async () => {
    const old = deferred()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    let pending!: Promise<void>
    act(() => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    await act(async () => commands.sendPointerClick({ x: 80, y: 80 }, 'left'))
    await act(async () => {
      old.resolve(unsupported)
      await pending
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'browser.mouseClick',
      'browser.mouseClick',
      'browser.mouseMove',
      'browser.mouseDown',
      'browser.mouseUp'
    ])
    expect(sendRequest.mock.calls[2][1]).toMatchObject({ x: 80, y: 80 })
  })

  it('abandons an old fallback before mouseDown when a newer click starts during move', async () => {
    const move = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(unsupported)
      .mockReturnValueOnce(move.promise)
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    let pending!: Promise<void>
    await act(async () => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    await act(async () => commands.sendPointerClick({ x: 80, y: 80 }, 'left'))
    await act(async () => {
      move.resolve(success)
      await pending
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'browser.mouseClick',
      'browser.mouseMove',
      'browser.mouseClick'
    ])
  })

  it('still releases a dispatched legacy mouseDown after a newer click starts', async () => {
    const down = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValueOnce(success)
      .mockReturnValueOnce(down.promise)
      .mockResolvedValue(success)
    await render({ sendRequest } as unknown as RpcClient)
    let pending!: Promise<void>
    await act(async () => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    await act(async () => commands.sendPointerClick({ x: 80, y: 80 }, 'left'))
    await act(async () => {
      down.resolve(success)
      await pending
    })
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'browser.mouseClick',
      'browser.mouseMove',
      'browser.mouseDown',
      'browser.mouseClick',
      'browser.mouseUp'
    ])
    expect(sendRequest.mock.calls[4][1]).toEqual({
      worktree: 'id:worktree',
      page: 'page-a',
      button: 'left'
    })
  })

  it('does not start legacy fallback after the client/page was replaced', async () => {
    const response = deferred()
    const oldSend = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue(success)
    const nextSend = vi.fn().mockResolvedValue(success)
    await render({ sendRequest: oldSend } as unknown as RpcClient)
    let pending!: Promise<void>
    act(() => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    await render({ sendRequest: nextSend } as unknown as RpcClient, 'page-b')
    await act(async () => {
      response.resolve(unsupported)
      await pending
    })
    expect(oldSend).toHaveBeenCalledTimes(1)
    expect(nextSend).not.toHaveBeenCalled()
  })

  it('only releases the original target after mouseDown completes across a scope change', async () => {
    const down = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValueOnce(success)
      .mockReturnValueOnce(down.promise)
      .mockResolvedValue(success)
    const client = { sendRequest } as unknown as RpcClient
    await render(client)
    let pending!: Promise<void>
    await act(async () => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    expect(sendRequest).toHaveBeenCalledTimes(3)
    await render(client, 'page-b')
    await act(async () => {
      down.resolve(success)
      await pending
    })
    expect(sendRequest).toHaveBeenCalledTimes(4)
    expect(sendRequest.mock.calls[3]).toEqual([
      'browser.mouseUp',
      {
        worktree: 'id:worktree',
        page: 'page-a',
        button: 'left'
      }
    ])
  })

  it('does not let old keyboard completion release the new source submission claim', async () => {
    const old = deferred(),
      next = deferred()
    const oldSend = vi.fn().mockReturnValue(old.promise)
    const nextSend = vi.fn().mockReturnValue(next.promise)
    await render({ sendRequest: oldSend } as unknown as RpcClient)
    act(() => commands.editKeyboardText('old'))
    let oldPending!: Promise<void>, newPending!: Promise<void>
    act(() => {
      oldPending = commands.sendKeyboardText()
    })
    await render({ sendRequest: nextSend } as unknown as RpcClient)
    act(() => commands.editKeyboardText('new'))
    const sendNew = commands.sendKeyboardText
    act(() => {
      newPending = sendNew()
    })
    await act(async () => {
      old.resolve({ ok: false, error: { message: 'Old failure' } })
      await oldPending
    })
    expect(keyboardText).toBe('')
    await act(async () => {
      await sendNew()
    })
    expect(nextSend).toHaveBeenCalledTimes(1)
    await act(async () => {
      next.resolve({ ok: false, error: { message: 'New failure' } })
      await newPending
    })
    expect(keyboardText).toBe('new')
  })

  it('does not clear B’s command error when A’s legacy mouseUp succeeds late', async () => {
    const up = deferred()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success)
      .mockReturnValueOnce(up.promise)
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal_error', message: 'B failed' } })
    const client = { sendRequest } as unknown as RpcClient
    await render(client)
    let pending!: Promise<void>
    await act(async () => {
      pending = commands.sendPointerClick({ x: 20, y: 20 }, 'left')
    })
    await render(client, 'page-b')
    await act(async () => commands.sendPointerClick({ x: 80, y: 80 }, 'left'))
    expect(error).toBe('B failed')
    await act(async () => {
      up.resolve(success)
      await pending
    })
    expect(error).toBe('B failed')
  })

  it('does not restore an old keyboard send after the source returns A → B → A', async () => {
    const response = deferred()
    const clientA = {
      sendRequest: vi.fn().mockReturnValue(response.promise)
    } as unknown as RpcClient
    const clientB = { sendRequest: vi.fn().mockResolvedValue(success) } as unknown as RpcClient
    await render(clientA)
    act(() => commands.editKeyboardText('old A'))
    let pending!: Promise<void>
    act(() => {
      pending = commands.sendKeyboardText()
    })
    await render(clientB)
    await render(clientA)
    act(() => commands.editKeyboardText('new A'))
    await act(async () => {
      response.resolve({ ok: false, error: { message: 'Old failure' } })
      await pending
    })
    expect(keyboardText).toBe('new A')
    expect(error).toBeNull()
  })
})
