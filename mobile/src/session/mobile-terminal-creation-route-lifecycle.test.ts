import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createElement, useLayoutEffect, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { formatUnknownErrorMessage } from '../transport/unknown-error-message'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import type { MobileQuickCommandLaunch } from '../terminal/quick-commands'
import type { MobileNewTabAgentOption } from './mobile-new-tab-agent-options'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'
import { terminalRecordsEqual } from './mobile-terminal-records'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'

const routeUrl = new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url)
const route = ts.createSourceFile(
  routeUrl.href,
  readFileSync(routeUrl, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations: ts.FunctionDeclaration[] = []
function findHandler(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleCreateTerminal') {
    declarations.push(node)
  }
  ts.forEachChild(node, findHandler)
}
findHandler(route)
if (declarations.length !== 1) {
  throw new Error('Expected the actual Session route handleCreateTerminal declaration')
}
const { code } = transformSync(declarations[0].getText(route), {
  loader: 'tsx',
  format: 'esm',
  sourcefile: routeUrl.pathname
})
type CreateTerminal = (
  agent?: MobileNewTabAgentOption['agent'],
  options?: MobileQuickCommandLaunch['options'] & { onPromptSent?: () => void; errorToast?: string }
) => Promise<void>
type Source = Parameters<typeof useMobileTerminalCreationOwner>[0]
type Event = [name: string, value?: unknown]
function deferred() {
  let resolve!: (response: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const created = {
  type: 'terminal',
  id: 'created-a',
  terminal: 'created-handle-a',
  title: 'A',
  isActive: true
}
const success = { ok: true, result: { tab: created } }
const accepted = { ok: true, result: { send: { accepted: true } } }
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})

async function harness(sendReceipt?: ReturnType<typeof deferred>) {
  const createReceipt = deferred()
  const events: Event[] = []
  const timers: { action: () => void; delay: number }[] = []
  const client = {
    sendRequest: vi.fn((method: string, params: unknown) => {
      events.push([method, params])
      return method === 'session.tabs.createTerminal'
        ? createReceipt.promise
        : (sendReceipt?.promise ?? Promise.resolve(accepted))
    })
  } as unknown as RpcClient
  const source: Source = { client, hostId: 'host-a', worktreeId: 'wt-a', connState: 'connected' }
  let current: {
    createTerminal: CreateTerminal
    creating: boolean
    tabs: MobileSessionTab[]
    terminals: Terminal[]
  }
  let renderer: ReactTestRenderer | null = null
  function Harness(props: Source) {
    const terminalCreation = useMobileTerminalCreationOwner(props)
    const activeHandleRef = useRef<string | null>(null)
    const [tabs, setSessionTabs] = useState<MobileSessionTab[]>([])
    const [terminals, setTerminals] = useState<Terminal[]>([])
    const terminalsRef = useRef(terminals)
    const initializedHandlesRef = useRef(new Set<string>())
    const pendingActiveSessionTabIdRef = useRef<string | null>(null)
    const activeSessionTabTypeRef = useRef('terminal')
    const pendingActiveTerminalHandleRef = useRef<string | null>(null)
    useLayoutEffect(() => {
      activeHandleRef.current = `active-${props.worktreeId}`
    }, [props.worktreeId])
    const dependencies = {
      client: props.client,
      terminalCreation,
      createMobileTerminalMutationId: () => 'fixture-mutation',
      worktreeId: props.worktreeId,
      activeSessionTabId: `tab-${props.worktreeId}`,
      activeHandleRef,
      initializedHandlesRef,
      pendingActiveSessionTabIdRef,
      activeSessionTabTypeRef,
      pendingActiveTerminalHandleRef,
      terminalsRef,
      setSessionTabs,
      setTerminals,
      terminalRecordsEqual,
      buildTerminalSendParams,
      deviceTokenRef: { current: 'fixture-device' },
      formatUnknownErrorMessage,
      setCreateError: (message: string) => events.push(['error', message]),
      unsubscribeTerminal: (handle: string) => events.push(['unsubscribe', handle]),
      setActiveSessionTabId: (id: string) => events.push(['select', id]),
      defaultTerminalHandlesToLiveInput: (handles: string[]) =>
        events.push(['live-input', handles]),
      setActiveHandle: (handle: string | null) => events.push(['active', handle]),
      subscribeToTerminal: (handle: string) => events.push(['subscribe', handle]),
      triggerSuccess: () => events.push(['success-haptic']),
      triggerError: () => events.push(['error-haptic']),
      showToast: (message: string) => events.push(['toast', message]),
      scheduleDelayedAction: (action: () => void, delay: number) => {
        timers.push({ action, delay })
      },
      fetchSessionTabs: () => {
        events.push(['fetch', props.worktreeId])
        return Promise.resolve()
      }
    }
    const createTerminal = new Function(
      ...Object.keys(dependencies),
      `${code};return handleCreateTerminal`
    )(...Object.values(dependencies)) as CreateTerminal
    current = { createTerminal, creating: terminalCreation.creating, tabs, terminals }
    return null
  }
  async function render(change: Partial<Source> = {}) {
    await act(async () => {
      const element = createElement(Harness, { ...source, ...change })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
        renderers.add(renderer)
      }
    })
  }
  function unmount() {
    const mounted = renderer
    if (mounted) {
      act(() => mounted.unmount())
      renderers.delete(mounted)
      renderer = null
    }
  }
  await render()
  return { events, timers, client, createReceipt, render, unmount, get: () => current! }
}

describe('actual Session route terminal creation lifecycle', () => {
  it.each(['worktree', 'client', 'unmount'])(
    'does not consume an old create receipt after %s changes',
    async (change) => {
      const h = await harness()
      let pending!: Promise<void>
      act(() => {
        pending = h.get().createTerminal(undefined, { initialPrompt: 'review A' })
      })
      if (change === 'unmount') {
        h.unmount()
      } else {
        await h.render(
          change === 'client'
            ? { client: { sendRequest: vi.fn() } as unknown as RpcClient }
            : { worktreeId: 'wt-b' }
        )
      }
      await act(async () => {
        h.createReceipt.resolve(success)
        await pending
      })
      expect(h.events).toEqual([
        ['error', ''],
        [
          'session.tabs.createTerminal',
          expect.objectContaining({ worktree: 'id:wt-a', clientMutationId: 'fixture-mutation' })
        ]
      ])
      expect(h.timers).toEqual([])
      expect(h.get().tabs).toEqual([])
      expect(h.get().terminals).toEqual([])
    }
  )

  it.each(['response', 'reject'])('keeps a late creation %s failure out of B', async (kind) => {
    const h = await harness()
    let pending!: Promise<void>
    act(() => {
      pending = h.get().createTerminal(undefined, { errorToast: 'Could not run A' })
    })
    await h.render({ worktreeId: 'wt-b' })
    await act(async () => {
      if (kind === 'reject') {
        h.createReceipt.reject(new Error('A disconnected'))
      } else {
        h.createReceipt.resolve({ ok: false, error: { message: 'A failure' } })
      }
      await pending
    })
    expect(h.events.filter(([name]) => ['error', 'toast', 'error-haptic'].includes(name))).toEqual([
      ['error', '']
    ])
  })

  it('rejects a detached entry after A → B → A without issuing a create', async () => {
    const h = await harness()
    const oldCreate = h.get().createTerminal
    await h.render({ worktreeId: 'wt-b' })
    await h.render()
    await act(async () => oldCreate())
    expect(h.events).toEqual([])
    expect(h.get().creating).toBe(false)
  })

  it.each(['worktree', 'unmount'])(
    'checks the accepted refresh timer owner after %s changes',
    async (change) => {
      const h = await harness()
      let pending!: Promise<void>
      act(() => {
        pending = h.get().createTerminal()
      })
      await act(async () => {
        h.createReceipt.resolve(success)
        await pending
      })
      expect(h.timers.map((timer) => timer.delay)).toEqual([500])
      if (change === 'unmount') {
        h.unmount()
      } else {
        await h.render({ worktreeId: 'wt-b' })
      }
      act(() => h.timers[0].action())
      expect(h.events.some(([name]) => name === 'fetch')).toBe(false)
    }
  )

  it.each(['accepted', 'rejected'])(
    'does not apply a late initial-prompt %s receipt to B',
    async (kind) => {
      const prompt = deferred()
      const h = await harness(prompt)
      const onPromptSent = vi.fn()
      let pending!: Promise<void>
      act(() => {
        pending = h.get().createTerminal(undefined, { initialPrompt: 'review A', onPromptSent })
      })
      await act(async () => {
        h.createReceipt.resolve(success)
        await pending
      })
      expect(h.events.filter(([name]) => name === 'terminal.send')).toEqual([
        [
          'terminal.send',
          {
            terminal: 'created-handle-a',
            text: 'review A',
            enter: true,
            client: { id: 'fixture-device', type: 'mobile' }
          }
        ]
      ])
      await h.render({ worktreeId: 'wt-b' })
      await act(async () => {
        if (kind === 'accepted') {
          prompt.resolve(accepted)
        } else {
          prompt.reject(new Error('A send disconnected'))
        }
        await Promise.resolve()
      })
      expect(onPromptSent).not.toHaveBeenCalled()
      expect(
        h.events.filter(([name]) => ['toast', 'success-haptic', 'error-haptic'].includes(name))
      ).toEqual([])
    }
  )

  it('keeps same-source creation, initial prompt, selection and refresh behavior', async () => {
    const h = await harness()
    const onPromptSent = vi.fn()
    let pending!: Promise<void>
    act(() => {
      pending = h.get().createTerminal(undefined, { initialPrompt: 'review A', onPromptSent })
    })
    expect(h.get().creating).toBe(true)
    await h.render()
    await act(async () => {
      h.createReceipt.resolve(success)
      await pending
    })
    expect(h.client.sendRequest).toHaveBeenCalledWith('session.tabs.createTerminal', {
      worktree: 'id:wt-a',
      afterTabId: 'tab-wt-a',
      clientMutationId: 'fixture-mutation',
      activate: false,
      select: true,
      navigation: 'caller'
    })
    expect(h.events).toContainEqual(['unsubscribe', 'active-wt-a'])
    expect(h.events).toContainEqual(['select', 'created-a'])
    expect(h.events).toContainEqual(['subscribe', 'created-handle-a'])
    expect(h.get().tabs).toEqual([created])
    expect(h.get().terminals).toEqual([{ handle: 'created-handle-a', title: 'A', isActive: true }])
    expect(onPromptSent).toHaveBeenCalledTimes(1)
    expect(h.events).toContainEqual(['toast', 'Notes sent'])
    expect(h.get().creating).toBe(false)
    expect(h.timers.map((timer) => timer.delay)).toEqual([500])
    act(() => h.timers[0].action())
    expect(h.events.filter(([name]) => name === 'fetch')).toEqual([['fetch', 'wt-a']])
  })
})
