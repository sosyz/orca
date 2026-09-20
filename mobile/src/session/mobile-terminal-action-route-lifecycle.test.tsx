import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createElement, useLayoutEffect, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { Terminal } from './mobile-session-route-types'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'

const routeUrl = new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url)
const route = ts.createSourceFile(
  routeUrl.href,
  readFileSync(routeUrl, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations = new Map<string, string>()
function findHandlers(node: ts.Node): void {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    ['handleClearTerminal', 'handleCloseTerminal'].includes(node.name.text)
  ) {
    declarations.set(node.name.text, node.getText(route))
  }
  ts.forEachChild(node, findHandlers)
}
findHandlers(route)
if (declarations.size !== 2) {
  throw new Error('Expected the actual Session route terminal action handlers')
}
function bind<T>(name: string, dependencies: Record<string, unknown>): T {
  const { code } = transformSync(declarations.get(name)!, {
    loader: 'tsx',
    format: 'esm',
    sourcefile: routeUrl.pathname
  })
  return new Function(...Object.keys(dependencies), `${code};return ${name}`)(
    ...Object.values(dependencies)
  ) as T
}
function deferred() {
  let resolve!: (response: unknown) => void
  const promise = new Promise<unknown>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const terminal = (handle: string): Terminal => ({ handle, title: handle, isActive: false })
type Source = {
  client: RpcClient
  hostId: string
  worktreeId: string
  connState: ConnectionState
}
type Handler = (target: Terminal) => Promise<void>
const initialSource: Omit<Source, 'client'> = {
  hostId: 'host-a',
  worktreeId: 'wt-a',
  connState: 'connected'
}
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})

async function harness(initial = [terminal('A')]) {
  const reply = deferred()
  const events: [string, unknown?][] = []
  const sendRequest = vi.fn(() => reply.promise)
  const client = { sendRequest } as unknown as RpcClient
  const source: Source = { client, ...initialSource }
  let renderer: ReactTestRenderer | null = null
  let current!: {
    clear: Handler
    close: Handler
    replace: (next: Terminal[]) => void
    queueClone: () => void
    queueAdd: (entry: Terminal) => void
    terminals: Terminal[]
    refHandles: () => string[]
  }
  function Harness(props: Source) {
    const terminalCreation = useMobileTerminalCreationOwner(props)
    const [terminals, setTerminals] = useState(initial)
    const terminalsRef = useRef(terminals)
    useLayoutEffect(() => {
      terminalsRef.current = terminals
    }, [terminals])
    const activeHandleRef = useRef<string | null>('A')
    const pendingActiveTerminalHandleRef = useRef<string | null>(null)
    const dependencies = {
      client: props.client,
      connState: props.connState,
      documentScopeActive:
        props.hostId === initialSource.hostId && props.worktreeId === initialSource.worktreeId,
      terminalCreation,
      terminals,
      terminalsRef,
      activeHandleRef,
      pendingActiveTerminalHandleRef,
      terminalRefs: { current: new Map() },
      initializedHandlesRef: { current: new Set() },
      terminalRenderedHandlesRef: { current: new Set() },
      getTerminalRef: () => ({ clear: () => events.push(['local-clear']) }),
      showToast: (message: string) => events.push(['toast', message]),
      unsubscribeTerminal: (handle: string) => events.push(['unsubscribe', handle]),
      clearTerminalLiveInputDefault: (handle: string) => events.push(['clear-default', handle]),
      subscribeToTerminal: (handle: string) => events.push(['subscribe', handle]),
      setActiveHandle: (handle: string | null) => events.push(['active', handle]),
      setTerminals
    }
    current = {
      clear: bind('handleClearTerminal', dependencies),
      close: bind('handleCloseTerminal', dependencies),
      replace: (next) => {
        terminalsRef.current = next
        setTerminals(next)
      },
      queueClone: () => setTerminals((previous) => [...previous]),
      queueAdd: (entry) => {
        activeHandleRef.current = entry.handle
        setTerminals((previous) => {
          const next = [...previous, entry]
          terminalsRef.current = next
          return next
        })
      },
      terminals,
      refHandles: () => terminalsRef.current.map((entry) => entry.handle)
    }
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
  return { events, sendRequest, reply, render, unmount, get: () => current }
}

describe('actual Session route terminal actions', () => {
  it('keeps the optimistic local clear but reports an RPC failure', async () => {
    const h = await harness()
    let pending!: Promise<void>
    act(() => {
      pending = h.get().clear(terminal('A'))
    })
    expect(h.events).toEqual([['local-clear']])
    await act(async () => {
      h.reply.resolve({ ok: false, error: { message: 'terminal_not_found' } })
      await pending
    })
    expect(h.events).toEqual([['local-clear'], ['toast', "Couldn't clear terminal"]])
  })

  it('ignores a detached clear callback and keeps an old clear receipt out of B', async () => {
    const h = await harness()
    const oldClear = h.get().clear
    let pending!: Promise<void>
    act(() => {
      pending = oldClear(terminal('A'))
    })
    await h.render({ worktreeId: 'wt-b' })
    act(() => {
      void oldClear(terminal('A'))
    })
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
    expect(h.events).toEqual([['local-clear']])
    await act(async () => {
      h.reply.resolve({ ok: true, result: { clear: { cleared: true } } })
      await pending
    })
    expect(h.events).toEqual([['local-clear']])
  })

  it('reports a confirmed clear success', async () => {
    const h = await harness()
    let pending!: Promise<void>
    act(() => {
      pending = h.get().clear(terminal('A'))
    })
    await act(async () => {
      h.reply.resolve({ ok: true, result: { clear: { cleared: true } } })
      await pending
    })
    expect(h.events).toEqual([['local-clear'], ['toast', 'Terminal cleared']])
  })

  it('keeps a terminal added while the fallback close is pending', async () => {
    const h = await harness()
    let pending!: Promise<void>
    act(() => {
      pending = h.get().close(terminal('A'))
      h.get().replace([terminal('A'), terminal('B')])
    })
    await act(async () => {
      h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
      await pending
    })
    expect(h.get().terminals.map((entry) => entry.handle)).toEqual(['B'])
  })

  it('keeps a functional terminal addition queued in the same React batch as close', async () => {
    const h = await harness()
    await act(async () => {
      const pending = h.get().close(terminal('A'))
      h.get().queueClone()
      h.get().queueAdd(terminal('B'))
      expect(h.get().refHandles()).toEqual(['A'])
      h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
      await pending
    })
    expect(h.get().terminals.map((entry) => entry.handle)).toEqual(['B'])
    expect(h.get().refHandles()).toEqual(['B'])
    expect(h.events).not.toContainEqual(['active', null])
  })

  it.each(['host', 'worktree', 'client', 'connection', 'ABA'])(
    'ignores an old fallback close receipt after %s changes',
    async (change) => {
      const h = await harness()
      let pending!: Promise<void>
      act(() => {
        pending = h.get().close(terminal('A'))
      })
      const changed =
        change === 'client'
          ? { client: { sendRequest: vi.fn() } as unknown as RpcClient }
          : change === 'connection'
            ? { connState: 'disconnected' as ConnectionState }
            : change === 'host'
              ? { hostId: 'host-b' }
              : { worktreeId: 'wt-b' }
      await h.render(changed)
      act(() => h.get().replace([terminal('B')]))
      if (change === 'ABA') {
        await h.render()
      }
      await act(async () => {
        h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
        await pending
      })
      expect(h.get().terminals.map((entry) => entry.handle)).toEqual(['B'])
      expect(
        h.events.filter(([name]) => name === 'unsubscribe' || name === 'clear-default')
      ).toEqual([])
    }
  )

  it('does not consume a late close response after unmount', async () => {
    const h = await harness()
    const pending = h.get().close(terminal('A'))
    h.unmount()
    h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
    await pending
    expect(h.events).toEqual([])
  })

  it('does not send a detached action-sheet close to the old client', async () => {
    const h = await harness()
    const oldClose = h.get().close
    await h.render({ worktreeId: 'wt-b' })
    await act(async () => oldClose(terminal('A')))
    expect(h.sendRequest).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it('does not use A action targets in B before the route scope reset commits', async () => {
    const h = await harness()
    await h.render({ worktreeId: 'wt-b' })
    await act(async () => {
      await h.get().clear(terminal('A'))
      await h.get().close(terminal('A'))
    })
    expect(h.sendRequest).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it('does not send a stale action-sheet target absent from the live terminal list', async () => {
    const h = await harness()
    act(() => h.get().replace([terminal('B')]))
    act(() => {
      void h.get().clear(terminal('A'))
      void h.get().close(terminal('A'))
    })
    expect(h.sendRequest).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it('does not clean up a target that left the current list while close was pending', async () => {
    const h = await harness()
    const pending = h.get().close(terminal('A'))
    act(() => h.get().replace([terminal('B')]))
    await act(async () => {
      h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
      await pending
    })
    expect(h.get().terminals.map((entry) => entry.handle)).toEqual(['B'])
    expect(h.events).toEqual([])
  })

  it('still replaces the active terminal after a valid close', async () => {
    const h = await harness([terminal('A'), terminal('B')])
    const pending = h.get().close(terminal('A'))
    await act(async () => {
      h.reply.resolve({ ok: true, result: { close: { handle: 'A' } } })
      await pending
    })
    expect(h.get().terminals.map((entry) => entry.handle)).toEqual(['B'])
    expect(h.events).toContainEqual(['active', 'B'])
    expect(h.events).toContainEqual(['subscribe', 'B'])
  })
})
