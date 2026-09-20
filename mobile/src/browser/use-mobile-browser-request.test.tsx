import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileBrowserRequest } from './use-mobile-browser-request'

type Response = { ok: true; result: unknown } | { ok: false; error: { message: string } }
type Request = ReturnType<typeof useMobileBrowserRequest>['sendBrowserRequest']
type HarnessState = {
  busy: boolean
  error: string | null
  request: Request
  retirePendingFeedback: () => void
  setError: (error: string | null) => void
}

let current: HarnessState
const renderers: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()))
})

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeClient(...responses: ReturnType<typeof deferredResponse>[]): RpcClient {
  let index = 0
  return {
    sendRequest: vi.fn(() => responses[index++].promise)
  } as unknown as RpcClient
}

function Harness({ client, pageId = 'page-a' }: { client: RpcClient; pageId?: string }) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { retirePendingFeedback, sendBrowserRequest } = useMobileBrowserRequest({
    busyRef,
    client,
    commandFailedMessage: 'Command failed',
    pageId,
    setBusy,
    setError,
    worktreeId: 'worktree-a'
  })
  current = { busy, error, request: sendBrowserRequest, retirePendingFeedback, setError }
  return createElement('Harness')
}

function renderHarness(client: RpcClient): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness, { client }))
  })
  renderers.push(renderer)
  return renderer
}

describe('useMobileBrowserRequest response ownership', () => {
  it('clears an earlier command error when the latest command succeeds', async () => {
    const response = deferredResponse()
    renderHarness(makeClient(response))
    let result!: Promise<unknown>
    act(() => {
      result = current.request('browser.reload')
      current.setError('Enter a valid URL.')
    })
    await act(async () => {
      response.resolve({ ok: true, result: { reloaded: true } })
      expect(await result).toEqual({ reloaded: true })
    })
    expect(current.error).toBeNull()
  })

  it('clears only its own command error after a later success', async () => {
    const failed = deferredResponse()
    const succeeded = deferredResponse()
    renderHarness(makeClient(failed, succeeded))
    let first!: Promise<unknown>
    act(() => {
      first = current.request('browser.goto')
    })
    await act(async () => {
      failed.resolve({ ok: false, error: { message: 'Navigation failed' } })
      await first
    })
    expect(current.error).toBe('Navigation failed')

    let second!: Promise<unknown>
    act(() => {
      second = current.request('browser.back')
    })
    await act(async () => {
      succeeded.resolve({ ok: true, result: {} })
      await second
    })
    expect(current.error).toBeNull()
  })

  it('returns a same-scope older success without replacing the latest error', async () => {
    const older = deferredResponse()
    const newer = deferredResponse()
    renderHarness(makeClient(older, newer))
    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = current.request('browser.back')
      second = current.request('browser.goto')
    })
    await act(async () => {
      newer.resolve({ ok: false, error: { message: 'New request failed' } })
      await second
    })
    await act(async () => {
      older.resolve({ ok: true, result: { stale: true } })
      expect(await first).toEqual({ stale: true })
    })
    expect(current.error).toBe('New request failed')
  })

  it.each([true, false])(
    'retires feedback without discarding delivery or busy completion (ok=%s)',
    async (ok) => {
      const response = deferredResponse()
      const client = makeClient(response)
      renderHarness(client)
      let pending!: Promise<unknown>
      act(() => {
        pending = current.request('browser.goto', {}, { showBusy: true })
      })
      expect(current.busy).toBe(true)
      act(() => {
        current.retirePendingFeedback()
        current.setError('Enter a valid URL.')
      })
      await act(async () => {
        response.resolve(
          ok
            ? { ok: true, result: { navigated: true } }
            : { ok: false, error: { message: 'Old navigation failed' } }
        )
        expect(await pending).toEqual(ok ? { navigated: true } : null)
      })
      expect(client.sendRequest).toHaveBeenCalledTimes(1)
      expect(current.busy).toBe(false)
      expect(current.error).toBe('Enter a valid URL.')
    }
  )

  it('ignores a batched failure after a newer command has started', async () => {
    const older = deferredResponse()
    const newer = deferredResponse()
    renderHarness(makeClient(older, newer))
    let first!: Promise<unknown>
    act(() => {
      first = current.request('browser.goto')
    })
    await act(async () => {
      older.resolve({ ok: false, error: { message: 'Stale navigation failed' } })
      await first
      const second = current.request('browser.back')
      newer.resolve({ ok: true, result: {} })
      await second
    })
    expect(current.error).toBeNull()
  })

  it('ignores a response from a replaced client and page', async () => {
    const oldResponse = deferredResponse()
    const newResponse = deferredResponse()
    const firstClient = makeClient(oldResponse)
    const secondClient = makeClient(newResponse)
    const renderer = renderHarness(firstClient)
    const oldRequest = current.request
    let first!: Promise<unknown>
    act(() => {
      first = current.request('browser.goto', {}, { showBusy: true })
      renderer.update(createElement(Harness, { client: secondClient, pageId: 'page-b' }))
    })
    act(() => current.setError('Current stream failed'))
    await act(async () => {
      oldResponse.resolve({ ok: true, result: { url: 'https://old.example' } })
      expect(await first).toBeNull()
    })
    expect(current.error).toBe('Current stream failed')
    expect(await oldRequest('browser.back')).toBeNull()
    expect(firstClient.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('ignores responses after unmount', async () => {
    const response = deferredResponse()
    const renderer = renderHarness(makeClient(response))
    let pending!: Promise<unknown>
    act(() => {
      pending = current.request('browser.goto')
      renderer.unmount()
    })
    response.resolve({ ok: true, result: { url: 'https://old.example' } })
    expect(await pending).toBeNull()
  })
})
