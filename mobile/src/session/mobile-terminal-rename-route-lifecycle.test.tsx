import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextInputModal } from '../components/TextInputModal'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('../components/mounted-bottom-drawer', () => ({
  MountedBottomDrawer: ({ children }: { children: React.ReactNode }) => children
}))

const routeUrl = new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url)
const routeText = readFileSync(routeUrl, 'utf8')
const route = ts.createSourceFile(
  routeUrl.href,
  routeText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let handlerDeclaration: ts.FunctionDeclaration | null = null
let modalElement: ts.JsxSelfClosingElement | null = null
function findRouteParts(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleRenameTerminal') {
    handlerDeclaration = node
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(route) === 'TextInputModal') {
    const title = node.attributes.properties.find(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(route) === 'title'
    )
    if (
      title &&
      ts.isJsxAttribute(title) &&
      title.initializer &&
      ts.isStringLiteral(title.initializer) &&
      title.initializer.text === 'Rename Terminal'
    ) {
      modalElement = node
    }
  }
  ts.forEachChild(node, findRouteParts)
}
findRouteParts(route)
if (!handlerDeclaration || !modalElement) {
  throw new Error('Expected the actual Session route Rename handler and modal')
}
const stateStart = routeText.indexOf('const [renameTarget')
const stateEnd = routeText.indexOf('const [customKeys', stateStart)
if (stateStart === -1 || stateEnd === -1) {
  throw new Error('Expected the actual Session route Rename state block')
}
const compile = (code: string) =>
  transformSync(code, {
    loader: 'tsx',
    format: 'esm',
    jsxFactory: 'createElement',
    sourcefile: routeUrl.pathname
  }).code
const stateCode = compile(
  `function useRenameState(){${routeText.slice(stateStart, stateEnd)};return {renameTarget,setRenameTarget,renameTargetState,renamePendingRef,renameLatestRef,isCurrentLiveTerminalHandle}}`
)
const handlerCode = compile(handlerDeclaration.getText(route))
const modalCode = compile(`function renderRenameModal(){return (${modalElement.getText(route)})}`)
function bind<T>(code: string, name: string, dependencies: Record<string, unknown>): T {
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
const terminalA: Terminal = { handle: 'terminal-A', title: 'A', isActive: true }
const terminalB: Terminal = { handle: 'terminal-B', title: 'B', isActive: true }
const tabFor = (terminal: Terminal): MobileSessionTab => ({
  id: `tab-${terminal.handle}`,
  type: 'terminal',
  terminal: terminal.handle,
  title: terminal.title
})
type Source = {
  client: RpcClient
  hostId: string
  worktreeId: string
  connState: ConnectionState
}
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})

async function harness() {
  const reply = deferred()
  const sendRequest = vi.fn(() => reply.promise)
  const client = { sendRequest } as unknown as RpcClient
  const source: Source = {
    client,
    hostId: 'host-a',
    worktreeId: 'wt-a',
    connState: 'connected'
  }
  const timers: (() => void)[] = []
  const firstFrame: { worktreeId: string; scopeActive: boolean; modalVisible: boolean }[] = []
  const fetchTerminals = vi.fn()
  let renderer: ReactTestRenderer | null = null
  let current!: { open: (target: Terminal) => void; title: string | null; modalVisible: boolean }
  function Harness(props: Source) {
    const terminalCreation = useMobileTerminalCreationOwner(props)
    const createFeedbackSource = useMemo(
      () => ({ client: props.client, hostId: props.hostId, worktreeId: props.worktreeId }),
      [props.client, props.hostId, props.worktreeId]
    )
    const [documentScope, setDocumentScope] = useState({
      hostId: props.hostId,
      worktreeId: props.worktreeId
    })
    const documentScopeActive =
      documentScope.hostId === props.hostId && documentScope.worktreeId === props.worktreeId
    const [terminals, setTerminals] = useState([terminalA])
    const terminalsRef = useRef(terminals)
    const sessionTabsRef = useRef<MobileSessionTab[]>([tabFor(terminalA)])
    useEffect(() => {
      const target = props.worktreeId === 'wt-a' ? terminalA : terminalB
      terminalsRef.current = [target]
      sessionTabsRef.current = [tabFor(target)]
      setTerminals([target])
      setDocumentScope({ hostId: props.hostId, worktreeId: props.worktreeId })
    }, [props.hostId, props.worktreeId])
    const stateDependencies = {
      useState,
      useRef,
      createFeedbackSource,
      documentScopeActive,
      terminalCreation,
      connState: props.connState,
      terminalsRef,
      sessionTabsRef
    }
    const useRenameState = bind<
      () => {
        renameTarget: Terminal | null
        setRenameTarget: (target: Terminal | null) => void
        renameTargetState: { target: Terminal; source: object; token: object } | null
        renamePendingRef: React.RefObject<Set<object>>
        renameLatestRef: React.RefObject<Map<string, object>>
        isCurrentLiveTerminalHandle: (handle: string) => boolean
      }
    >(stateCode, 'useRenameState', stateDependencies)
    const {
      renameTarget,
      setRenameTarget,
      renameTargetState,
      renamePendingRef,
      renameLatestRef,
      isCurrentLiveTerminalHandle
    } = useRenameState()
    useLayoutEffect(() => {
      firstFrame.push({
        worktreeId: props.worktreeId,
        scopeActive: documentScopeActive,
        modalVisible: renameTarget !== null
      })
    })
    const handlerDependencies = {
      client: props.client,
      connState: props.connState,
      documentScopeActive,
      terminalCreation,
      renameTarget,
      renameTargetState,
      renamePendingRef,
      renameLatestRef,
      isCurrentLiveTerminalHandle,
      setRenameTarget,
      terminalsRef,
      sessionTabsRef,
      setTerminals,
      scheduleDelayedAction: (callback: () => void) => timers.push(callback),
      fetchTerminals
    }
    const handleRenameTerminal = bind<(value: string) => Promise<void>>(
      handlerCode,
      'handleRenameTerminal',
      handlerDependencies
    )
    const renderRenameModal = bind<() => React.ReactElement>(modalCode, 'renderRenameModal', {
      createElement,
      TextInputModal,
      renameTarget,
      handleRenameTerminal,
      setRenameTarget
    })
    current = {
      open: (target) => setRenameTarget(target),
      title: terminals[0]?.title ?? null,
      modalVisible: renameTarget !== null
    }
    return renderRenameModal()
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
  await render()
  return {
    reply,
    sendRequest,
    timers,
    firstFrame,
    fetchTerminals,
    render,
    unmount: () => {
      act(() => renderer!.unmount())
      renderers.delete(renderer!)
    },
    get: () => current,
    modal: () => renderer!.root.findByType(TextInputModal),
    input: () => renderer!.root.findByType('TextInput')
  }
}

describe('actual Session route terminal Rename', () => {
  it('does not submit A terminal from a modal retained after switching to B worktree', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    expect(h.modal().props.visible).toBe(true)
    await h.render({ worktreeId: 'wt-b' })
    expect(h.firstFrame.find((frame) => frame.worktreeId === 'wt-b')).toEqual({
      worktreeId: 'wt-b',
      scopeActive: false,
      modalVisible: false
    })
    expect(h.modal().props.visible).toBe(false)
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest).not.toHaveBeenCalled()
  })

  it('does not resurrect A Rename after A → B → A or client replacement', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    await h.render({ worktreeId: 'wt-b' })
    await h.render()
    expect(h.modal().props.visible).toBe(false)
    await h.render({ client: { sendRequest: vi.fn() } as unknown as RpcClient })
    expect(h.modal().props.visible).toBe(false)
  })

  it('does not grant a stale A action-sheet callback the B source', async () => {
    const h = await harness()
    const oldOpen = h.get().open
    await h.render({ worktreeId: 'wt-b' })
    act(() => oldOpen(terminalA))
    expect(h.modal().props.visible).toBe(false)
    expect(h.sendRequest).not.toHaveBeenCalled()
  })

  it('keeps an edited draft through a same-source disconnect and reconnect', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('draft title'))
    await h.render({ connState: 'disconnected' })
    expect(h.modal().props.visible).toBe(true)
    expect(h.input().props.value).toBe('draft title')
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest).not.toHaveBeenCalled()
    await h.render()
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest).toHaveBeenCalledOnce()
  })

  it('ignores an accepted A rename receipt after switching to B', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('renamed A'))
    act(() => h.input().props.onSubmitEditing())
    await h.render({ worktreeId: 'wt-b' })
    await act(async () => h.reply.resolve({ ok: true, result: { rename: true } }))
    expect(h.get().title).toBe('B')
    expect(h.timers).toHaveLength(0)
  })

  it('keeps a normal same-source rename and refresh', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('new title'))
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest).toHaveBeenCalledWith('terminal.rename', {
      terminal: 'terminal-A',
      title: 'new title'
    })
    await act(async () => h.reply.resolve({ ok: true, result: { rename: true } }))
    expect(h.get().title).toBe('new title')
    expect(h.timers).toHaveLength(1)
    act(() => h.timers[0]())
    expect(h.fetchTerminals).toHaveBeenCalledOnce()
  })

  it('does not send two same-target rename RPCs from same-batch double submit', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => {
      h.input().props.onSubmitEditing()
      h.input().props.onSubmitEditing()
    })
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('allows a newly opened dialog to submit a different title while the prior rename is pending', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('first title'))
    act(() => h.input().props.onSubmitEditing())
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('second title'))
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest.mock.calls).toEqual([
      ['terminal.rename', { terminal: 'terminal-A', title: 'first title' }],
      ['terminal.rename', { terminal: 'terminal-A', title: 'second title' }]
    ])
  })

  it('does not let the older accepted rename receipt overwrite a newer same-terminal title', async () => {
    const h = await harness()
    const first = deferred()
    const second = deferred()
    h.sendRequest
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('first title'))
    act(() => h.input().props.onSubmitEditing())
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('second title'))
    act(() => h.input().props.onSubmitEditing())
    await act(async () => second.resolve({ ok: true, result: { rename: true } }))
    expect(h.get().title).toBe('second title')
    await act(async () => first.resolve({ ok: true, result: { rename: true } }))
    expect(h.get().title).toBe('second title')
    expect(h.timers).toHaveLength(1)
  })

  it('does not apply an accepted rename after the route unmounts', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onSubmitEditing())
    h.unmount()
    await act(async () => h.reply.resolve({ ok: true, result: { rename: true } }))
    expect(h.timers).toHaveLength(0)
  })

  it('allows clearing a custom terminal title like the desktop Rename action', async () => {
    const h = await harness()
    act(() => h.get().open(terminalA))
    act(() => h.input().props.onChangeText('   '))
    act(() => h.input().props.onSubmitEditing())
    expect(h.sendRequest).toHaveBeenCalledWith('terminal.rename', {
      terminal: 'terminal-A',
      title: ''
    })
    await act(async () => h.reply.resolve({ ok: true, result: { rename: true } }))
    expect(h.get().title).toBe('Terminal')
  })
})
