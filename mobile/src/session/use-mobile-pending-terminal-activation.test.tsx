import { createElement, useEffect, useMemo } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'
import { useMobilePendingTerminalActivation } from './use-mobile-pending-terminal-activation'
import { MobileSessionTabsStreamHealth } from './mobile-session-tabs-stream-health'

const tab = (id: string, terminal: string | null = null, leafId = 'leaf'): MobileSessionTab => ({
  type: 'terminal',
  id,
  title: id,
  terminal,
  leafId,
  isActive: true
})
function snapshot(id = 'a', version = 20): SessionTabsResult {
  return {
    worktree: 'a',
    publicationEpoch: 'host',
    snapshotVersion: version,
    tabs: [tab(id, `term-${id}`)],
    activeTabId: id,
    activeTabType: 'terminal'
  }
}
function success(result = snapshot()): RpcResponse {
  return { id: 'activate', ok: true, result, _meta: { runtimeId: 'host' } }
}
function deferred() {
  let resolve!: (response: RpcResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RpcResponse>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
type Props = {
  client: RpcClient
  hostId: string
  worktreeId: string
  connState: 'connected' | 'disconnected'
  activeSessionTab: MobileSessionTab | null
  documentScopeActive: boolean
}
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})
async function harness() {
  const first = deferred()
  const sendRequest = vi.fn<RpcClient['sendRequest']>().mockResolvedValue(success())
  sendRequest.mockReturnValueOnce(first.promise)
  const source: Props = {
    client: { sendRequest } as unknown as RpcClient,
    hostId: 'host',
    worktreeId: 'a',
    connState: 'connected',
    activeSessionTab: tab('a'),
    documentScopeActive: true
  }
  const apply = vi.fn(() => ({ accepted: true as const, effectiveTabs: [] }))
  const timers: { action: () => void; delay: number }[] = []
  let current = source
  function Harness(props: Props): null {
    const owner = useMobileTerminalCreationOwner(props)
    const controller = useMemo(
      () =>
        new MobileSessionTabsStreamHealth({
          client: props.client,
          scope: `id:${props.worktreeId}`,
          apply,
          consumeAccepted() {},
          hasRecoveryNeed: () => false
        }),
      [props.client, props.worktreeId]
    )
    useEffect(() => {
      controller.setReconciliationActive(true)
      return () => controller.dispose()
    }, [controller])
    useMobilePendingTerminalActivation({
      ...props,
      isCurrentSource: owner.isCurrent,
      isCurrentDocumentScope: () => props.documentScopeActive,
      applySessionTabs: apply,
      fetchSessionTabs: () => controller.requestReconciliation(),
      scheduleDelayedAction: (action, delay) => timers.push({ action, delay })
    })
    return null
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(Harness, current))
  })
  renderers.add(renderer)
  return {
    first,
    sendRequest,
    apply,
    timers,
    source,
    update: async (patch: Partial<Props>) => {
      current = { ...current, ...patch }
      await act(async () => renderer.update(createElement(Harness, current)))
    },
    finish: async () => act(async () => first.resolve(success())),
    unmount: () => {
      act(() => renderer.unmount())
      renderers.delete(renderer)
    }
  }
}

describe('pending terminal activation owner', () => {
  it.each(['worktree', 'client', 'tab', 'leaf', 'disconnect', 'unmount', 'ABA'] as const)(
    'ignores a late activation after %s',
    async (change) => {
      const h = await harness()
      if (change === 'worktree') {
        await h.update({ worktreeId: 'b', activeSessionTab: tab('b', 'term-b') })
      }
      if (change === 'client') {
        await h.update({
          client: { sendRequest: vi.fn().mockResolvedValue(success()) } as unknown as RpcClient,
          activeSessionTab: tab('b', 'term-b')
        })
      }
      if (change === 'tab') {
        await h.update({ activeSessionTab: tab('b', 'term-b') })
      }
      if (change === 'leaf') {
        await h.update({ activeSessionTab: tab('a', 'term-a', 'new-leaf') })
      }
      if (change === 'disconnect') {
        await h.update({ connState: 'disconnected' })
      }
      if (change === 'unmount') {
        h.unmount()
      }
      if (change === 'ABA') {
        await h.update({ activeSessionTab: tab('b', 'term-b') })
        h.sendRequest.mockReturnValueOnce(new Promise<RpcResponse>(() => {}))
        await h.update({ activeSessionTab: tab('a') })
      }
      await h.finish()
      expect(h.apply).not.toHaveBeenCalled()
      expect(h.timers).toHaveLength(0)
    }
  )

  it('retains a same-target snapshot refresh and the ready-target follow-up timers', async () => {
    const h = await harness()
    await h.update({ activeSessionTab: { ...tab('a'), title: 'renamed' } })
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
    await h.finish()
    expect(h.apply).toHaveBeenCalledOnce()
    expect(h.timers.map((timer) => timer.delay)).toEqual([300, 1200])
    await h.update({ activeSessionTab: tab('a', 'term-a') })
    await act(async () => {
      h.timers[0].action()
    })
    expect(h.sendRequest).toHaveBeenCalledTimes(2)
    expect(h.sendRequest).toHaveBeenLastCalledWith('session.tabs.list', { worktree: 'id:a' })
  })

  it('activates again when a ready terminal loses its handle in a later snapshot', async () => {
    const h = await harness()
    await h.finish()
    await h.update({ activeSessionTab: tab('a', 'term-a') })
    await h.update({ activeSessionTab: tab('a') })
    expect(h.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('rechecks the active target before an accepted delayed refresh', async () => {
    const h = await harness()
    await h.finish()
    await h.update({ activeSessionTab: tab('b', 'term-b') })
    await act(async () => {
      h.timers.forEach((timer) => timer.action())
    })
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('waits for the document scope to catch up before activation', async () => {
    const h = await harness()
    h.unmount()
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockResolvedValue(success())
    function Harness({ ready }: { ready: boolean }): null {
      useMobilePendingTerminalActivation({
        client: { sendRequest } as unknown as RpcClient,
        connState: 'connected',
        worktreeId: 'b',
        activeSessionTab: tab('a'),
        isCurrentSource: () => true,
        isCurrentDocumentScope: () => ready,
        applySessionTabs: vi.fn(),
        fetchSessionTabs: async () => {},
        scheduleDelayedAction: vi.fn()
      })
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { ready: false }))
    })
    renderers.add(renderer)
    expect(sendRequest).not.toHaveBeenCalled()
    await act(async () => renderer.update(createElement(Harness, { ready: true })))
    expect(sendRequest).toHaveBeenCalledOnce()
  })

  it.each(['failure', 'reject'] as const)(
    'allows a later same-target snapshot to retry a %s',
    async (mode) => {
      const h = await harness()
      await act(async () => {
        if (mode === 'reject') {
          h.first.reject(new Error('offline'))
        } else {
          h.first.resolve({
            id: 'rpc',
            ok: false,
            error: { code: 'internal_error', message: 'failed' }
          })
        }
      })
      expect(h.apply).not.toHaveBeenCalled()
      await h.update({ activeSessionTab: { ...tab('a') } })
      expect(h.sendRequest).toHaveBeenCalledTimes(2)
      expect(h.apply).toHaveBeenCalledOnce()
    }
  )

  it('does not retry a retired request after a logical connection cutover', async () => {
    const h = await harness()
    await h.update({ activeSessionTab: tab('b', 'term-b') })
    await act(async () => h.first.reject(new LogicalClientCutoverError()))
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('retains the existing single cutover retry for the current target', async () => {
    const h = await harness()
    await act(async () => h.first.reject(new LogicalClientCutoverError()))
    expect(h.sendRequest).toHaveBeenCalledTimes(2)
    expect(h.apply).toHaveBeenCalledOnce()
  })
})
