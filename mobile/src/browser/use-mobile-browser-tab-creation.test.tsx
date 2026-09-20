import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { runAcceptedMobileSessionTabsEffects } from '../session/mobile-session-tabs-accepted-effects'
import { useMobileBrowserTabCreation } from './use-mobile-browser-tab-creation'

type Params = Parameters<typeof useMobileBrowserTabCreation>[0]
const success = (browserPageId = 'page-a') => ({ ok: true, result: { browserPageId } })
const failure = (message: string) => ({ ok: false, error: { code: 'internal_error', message } })
function deferred() {
  let resolve!: (response: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useMobileBrowserTabCreation', () => {
  let renderer: ReactTestRenderer | null = null
  let current: ReturnType<typeof useMobileBrowserTabCreation>
  let args: Params
  let sendRequest: ReturnType<typeof vi.fn>
  let timers: { action: () => void; delay: number }[]

  function Harness(props: Params) {
    current = useMobileBrowserTabCreation(props)
    return null
  }
  async function render(next: Partial<Params> = {}) {
    args = { ...args, ...next }
    await act(async () => {
      const element = createElement(Harness, args)
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }
  beforeEach(() => {
    timers = []
    sendRequest = vi.fn().mockResolvedValue(success())
    args = {
      client: { sendRequest } as unknown as RpcClient,
      connState: 'connected',
      hostId: 'host-a',
      worktreeId: 'wt-a',
      browserScreencastSupportedRef: { current: true },
      pendingBrowserFocusPageIdRef: { current: null },
      fetchSessionTabs: vi.fn().mockResolvedValue(undefined),
      fetchPendingBrowserSessionTabs: vi.fn().mockResolvedValue(undefined),
      scheduleDelayedAction: vi.fn((action, delay) => {
        timers.push({ action, delay })
      }),
      setCreateError: vi.fn(),
      showToast: vi.fn(),
      setShowCreateBrowserModal: vi.fn()
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('claims same-render keyboard/button submission before dispatch', async () => {
    const response = deferred()
    sendRequest.mockReturnValue(response.promise)
    await render()
    const createTab = current.handleCreateBrowser
    let first!: Promise<boolean>, second!: Promise<boolean>
    act(() => {
      first = createTab('https://a.example')
      second = createTab('https://a.example')
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(await second).toBe(false)
    expect(current.creatingBrowser).toBe(true)
    await act(async () => {
      response.resolve(success())
      expect(await first).toBe(true)
    })
    expect(current.creatingBrowser).toBe(false)
  })

  it.each(['client', 'worktree', 'host'] as const)(
    'keeps late success out of a new %s source',
    async (change) => {
      const old = deferred(),
        next = deferred()
      sendRequest.mockReturnValueOnce(old.promise).mockReturnValue(next.promise)
      await render()
      let pending!: Promise<boolean>
      act(() => {
        pending = current.handleCreateBrowser('https://a.example')
      })
      const nextSend = vi.fn().mockReturnValue(next.promise)
      await render(
        change === 'client'
          ? { client: { sendRequest: nextSend } as unknown as RpcClient }
          : change === 'host'
            ? { hostId: 'host-b' }
            : { worktreeId: 'wt-b' }
      )
      expect(current.creatingBrowser).toBe(false)
      let newPending!: Promise<boolean>
      act(() => {
        newPending = current.handleCreateBrowser('https://b.example')
      })
      await act(async () => {
        old.resolve(success('old-page'))
        expect(await pending).toBe(false)
      })
      expect(current.creatingBrowser).toBe(true)
      expect(args.pendingBrowserFocusPageIdRef.current).toBeNull()
      expect(args.fetchSessionTabs).not.toHaveBeenCalled()
      await act(async () => {
        next.resolve(success('new-page'))
        expect(await newPending).toBe(true)
      })
      expect(args.pendingBrowserFocusPageIdRef.current).toBe('new-page')
      expect(args.fetchSessionTabs).toHaveBeenCalledTimes(1)
      expect(timers.map((timer) => timer.delay)).toEqual([400, 1200])
    }
  )

  it('ignores an old failure without releasing the new source claim', async () => {
    const old = deferred(),
      next = deferred()
    sendRequest.mockReturnValueOnce(old.promise).mockReturnValue(next.promise)
    await render()
    let pending!: Promise<boolean>, newPending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    await render({ worktreeId: 'wt-b' })
    act(() => {
      newPending = current.handleCreateBrowser()
    })
    vi.mocked(args.setCreateError).mockClear()
    await act(async () => {
      old.reject(new Error('old disconnected'))
      await pending
    })
    expect(args.setCreateError).not.toHaveBeenCalled()
    expect(args.showToast).not.toHaveBeenCalled()
    expect(current.creatingBrowser).toBe(true)
    await act(async () => {
      next.resolve(success('page-b'))
      await newPending
    })
  })

  it('does not replace a completed new source focus with an older receipt', async () => {
    const old = deferred()
    sendRequest.mockReturnValueOnce(old.promise).mockResolvedValue(success('page-b'))
    await render()
    let pending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    await render({ worktreeId: 'wt-b' })
    await act(async () => current.handleCreateBrowser())
    expect(args.pendingBrowserFocusPageIdRef.current).toBe('page-b')
    await act(async () => {
      old.resolve(success('page-a'))
      expect(await pending).toBe(false)
    })
    expect(args.pendingBrowserFocusPageIdRef.current).toBe('page-b')
    expect(args.fetchSessionTabs).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(2)
  })

  it('retains an in-flight source claim across A → B → A until that RPC settles', async () => {
    const response = deferred()
    sendRequest.mockReturnValueOnce(response.promise).mockResolvedValue(success('new-a'))
    await render()
    let pending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    await render({ worktreeId: 'wt-b' })
    await render({ worktreeId: 'wt-a' })
    expect(current.creatingBrowser).toBe(true)
    await act(async () => {
      expect(await current.handleCreateBrowser()).toBe(false)
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      response.resolve(success('old-a'))
      expect(await pending).toBe(false)
    })
    expect(current.creatingBrowser).toBe(false)
    expect(args.pendingBrowserFocusPageIdRef.current).toBeNull()
    await act(async () => {
      expect(await current.handleCreateBrowser()).toBe(true)
    })
    expect(args.pendingBrowserFocusPageIdRef.current).toBe('new-a')
  })

  it('retires an old request on disconnect even when the same client reconnects', async () => {
    const response = deferred()
    sendRequest.mockReturnValue(response.promise)
    await render()
    let pending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    await render({ connState: 'disconnected' })
    await render({ connState: 'connected' })
    await act(async () => {
      response.resolve(success())
      expect(await pending).toBe(false)
    })
    expect(args.fetchSessionTabs).not.toHaveBeenCalled()
    expect(args.pendingBrowserFocusPageIdRef.current).toBeNull()
    expect(current.creatingBrowser).toBe(false)
  })

  it('does not publish creation receipts or start timers after unmount', async () => {
    const response = deferred()
    sendRequest.mockReturnValue(response.promise)
    await render()
    let pending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    act(() => renderer?.unmount())
    renderer = null
    response.resolve(success())
    expect(await pending).toBe(false)
    expect(args.pendingBrowserFocusPageIdRef.current).toBeNull()
    expect(args.fetchSessionTabs).not.toHaveBeenCalled()
    expect(timers).toEqual([])
  })

  it('does not let stale entry callbacks create or cancel the new source dialog', async () => {
    await render()
    const old = current
    await render({ worktreeId: 'wt-b' })
    await act(async () => {
      old.openBrowserDialog()
      old.cancelBrowserDialog()
      expect(await old.handleCreateBrowser()).toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(args.setShowCreateBrowserModal).not.toHaveBeenCalled()
  })

  it('keeps a canceled and reopened dialog when the original create succeeds', async () => {
    const response = deferred()
    sendRequest.mockReturnValue(response.promise)
    await render()
    act(() => current.openBrowserDialog())
    let pending!: Promise<void>
    act(() => {
      pending = current.submitBrowserUrl('https://a.example')
    })
    act(() => {
      current.cancelBrowserDialog()
      current.openBrowserDialog()
    })
    vi.mocked(args.setShowCreateBrowserModal).mockClear()
    await act(async () => {
      response.resolve(success())
      await pending
    })
    expect(args.setShowCreateBrowserModal).not.toHaveBeenCalled()
    expect(args.pendingBrowserFocusPageIdRef.current).toBe('page-a')
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('closes only the submitting dialog on a normal accepted creation', async () => {
    await render()
    act(() => current.openBrowserDialog())
    await act(async () => current.submitBrowserUrl('example.com'))
    expect(args.setShowCreateBrowserModal).toHaveBeenLastCalledWith(false)
    expect(sendRequest).toHaveBeenCalledWith(
      'browser.tabCreate',
      { worktree: 'id:wt-a', url: 'https://example.com/', activate: true },
      { timeoutMs: 30_000 }
    )
  })

  it('preserves immediate and pending recovery refreshes and focuses the accepted tab once', async () => {
    await render()
    await act(async () => {
      expect(await current.handleCreateBrowser()).toBe(true)
    })
    expect(args.fetchSessionTabs).toHaveBeenCalledTimes(1)
    expect(timers.map((timer) => timer.delay)).toEqual([400, 1200])
    act(() => timers.forEach((timer) => timer.action()))
    expect(args.fetchPendingBrowserSessionTabs).toHaveBeenCalledTimes(2)
    const activate = vi.fn()
    const accepted = {
      effectiveTabs: [{ id: 'tab-a', type: 'browser', isActive: false, browserPageId: 'page-a' }],
      source: 'stream' as const,
      getPendingBrowserPageId: () => args.pendingBrowserFocusPageIdRef.current,
      clearPendingBrowserPageId: () => {
        args.pendingBrowserFocusPageIdRef.current = null
      },
      activateBrowserTab: activate,
      markActiveMarkdownStale: vi.fn()
    }
    runAcceptedMobileSessionTabsEffects(accepted)
    runAcceptedMobileSessionTabsEffects(accepted)
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it.each(['worktree', 'client', 'disconnect', 'ABA', 'unmount'])(
    'checks a refresh timer owner when it runs after %s',
    async (change) => {
      await render()
      await act(async () => current.handleCreateBrowser())
      if (change === 'worktree' || change === 'ABA') {
        await render({ worktreeId: 'wt-b' })
        if (change === 'ABA') {
          await render({ worktreeId: 'wt-a' })
        }
      } else if (change === 'client') {
        await render({ client: { sendRequest } as unknown as RpcClient })
      } else if (change === 'disconnect') {
        await render({ connState: 'disconnected' })
      } else {
        act(() => renderer?.unmount())
        renderer = null
      }
      act(() => timers.forEach((timer) => timer.action()))
      expect(args.fetchPendingBrowserSessionTabs).not.toHaveBeenCalled()
    }
  )

  it('uses latest same-source refresh callbacks without retiring an accepted operation', async () => {
    const response = deferred()
    sendRequest.mockReturnValue(response.promise)
    await render()
    const oldFetch = args.fetchSessionTabs
    let pending!: Promise<boolean>
    act(() => {
      pending = current.handleCreateBrowser()
    })
    await render({ fetchSessionTabs: vi.fn().mockResolvedValue(undefined) })
    await act(async () => {
      response.resolve(success())
      expect(await pending).toBe(true)
    })
    expect(oldFetch).not.toHaveBeenCalled()
    expect(args.fetchSessionTabs).toHaveBeenCalledTimes(1)
  })

  it('reads the current capability ref and preserves invalid URL feedback without dispatch', async () => {
    await render({ browserScreencastSupportedRef: { current: null } })
    act(() => current.openBrowserDialog())
    expect(args.showToast).toHaveBeenLastCalledWith(
      'Desktop update required for mobile browser streaming',
      1600
    )
    await act(async () => {
      expect(await current.handleCreateBrowser()).toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    args.browserScreencastSupportedRef.current = true
    act(() => current.openBrowserDialog())
    expect(args.setShowCreateBrowserModal).toHaveBeenLastCalledWith(true)
    await act(async () => {
      expect(await current.handleCreateBrowser('javascript:alert(1)')).toBe(false)
    })
    expect(args.setCreateError).toHaveBeenLastCalledWith('Enter a valid URL')
    expect(sendRequest).not.toHaveBeenCalled()
    await act(async () => {
      expect(await current.handleCreateBrowser('')).toBe(true)
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'browser.tabCreate',
      { worktree: 'id:wt-a', url: 'about:blank', activate: true },
      { timeoutMs: 30_000 }
    )
  })

  it.each([
    ['folder:folder-a', 'file:///tmp/note.html'],
    ['ssh-repo:worktree-a', 'localhost:3000']
  ])('preserves host-owned workspace and URL semantics for %s', async (worktreeId, url) => {
    await render({ worktreeId })
    await act(async () => current.handleCreateBrowser(url))
    expect(sendRequest).toHaveBeenCalledWith(
      'browser.tabCreate',
      {
        worktree: `id:${worktreeId}`,
        url: url.startsWith('file:') ? url : 'http://localhost:3000/',
        activate: true
      },
      { timeoutMs: 30_000 }
    )
  })

  it('keeps refresh compatibility when an older host omits browserPageId', async () => {
    sendRequest.mockResolvedValue({ ok: true, result: {} })
    await render()
    await act(async () => {
      expect(await current.handleCreateBrowser()).toBe(true)
    })
    expect(args.pendingBrowserFocusPageIdRef.current).toBeNull()
    expect(args.fetchSessionTabs).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(2)
  })

  it.each(['failure', 'unknown'])(
    'surfaces current %s without automatically replaying creation',
    async (kind) => {
      if (kind === 'failure') {
        sendRequest.mockResolvedValue(failure('Host refused'))
      } else {
        sendRequest.mockRejectedValue(markRpcDeliveryUnknown(new Error('Response timed out')))
      }
      await render()
      await act(async () => {
        expect(await current.handleCreateBrowser()).toBe(false)
      })
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(args.showToast).toHaveBeenLastCalledWith(
        kind === 'failure' ? 'Host refused' : 'Response timed out',
        1800
      )
      expect(current.creatingBrowser).toBe(false)
      expect(timers).toEqual([])
    }
  )
})
