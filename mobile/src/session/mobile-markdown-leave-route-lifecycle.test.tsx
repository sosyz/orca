import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionSheetModal } from '../components/ActionSheetModal'
import type { RpcClient } from '../transport/rpc-client'
import {
  collectDirtyMobileMarkdownDrafts,
  copyMobileMarkdownDraftsBeforeLeave
} from './mobile-markdown-leave'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ Edit3: 'Edit3', FileText: 'FileText', Trash2: 'Trash2' }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: React.ReactNode }) => children
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
function section(start: string, end: string): string {
  const first = routeText.indexOf(start)
  const last = routeText.indexOf(end, first)
  if (first === -1 || last <= first) {
    throw new Error(`Missing actual Session route section: ${start}`)
  }
  return routeText.slice(first, last)
}
function compile(source: string): string {
  return transformSync(source, {
    loader: 'tsx',
    format: 'esm',
    jsxFactory: 'createElement',
    sourcefile: routeUrl.pathname
  }).code
}
function bind<T>(source: string, name: string, dependencies: Record<string, unknown>): T {
  return new Function(...Object.keys(dependencies), `${source};return ${name}`)(
    ...Object.values(dependencies)
  ) as T
}
const ownerCode = compile(
  `function useLeaveOwner(){${section('const [leaveFocusToken,', 'const [createFeedback,')};return {leaveFocusToken,leaveFocusTokenRef,leavePromptTokenRef,leaveCopyIntentRef,isCurrentLeaveSource}}`
)
const promptCode = compile(
  `function useLeavePrompt(){${section('const [leaveDraftsState,', 'const [renameTargetState,')};return {leaveDraftsState,leaveDrafts,setLeaveDrafts}}`
)
const actionCode = compile(
  `function useLeaveActions(){${section('const getDirtyMarkdownDrafts =', 'const dismissSoftwareKeyboard =')}${section('const requestLeaveSession =', 'useEffect(() => {\n    const subscription = BackHandler')};return {requestLeaveSession,handleCopyDraftsAndLeave,handleDiscardDraftsAndLeave}}`
)
const editCode = compile(
  `function useMarkdownEdit(){${section('const updateMarkdownLocalContent =', 'const copyMarkdownLocalContent =')};return updateMarkdownLocalContent}`
)
let leaveModal: ts.JsxSelfClosingElement | null = null
let backHandler: ts.ArrowFunction | null = null
function visit(node: ts.Node): void {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(route) === 'ActionSheetModal') {
    const title = node.attributes.properties.find(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'title'
    )
    if (
      title &&
      ts.isJsxAttribute(title) &&
      title.initializer &&
      ts.isStringLiteral(title.initializer) &&
      title.initializer.text === 'Unsaved markdown changes'
    ) {
      leaveModal = node
    }
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(route) === 'BackHandler.addEventListener' &&
    node.arguments[0]?.getText(route) === "'hardwareBackPress'" &&
    node.arguments[1] &&
    ts.isArrowFunction(node.arguments[1])
  ) {
    backHandler = node.arguments[1]
  }
  ts.forEachChild(node, visit)
}
visit(route)
if (!leaveModal || !backHandler) {
  throw new Error('Missing actual Session route leave callbacks')
}
const modalCode = compile(`function renderLeaveModal(){return (${leaveModal.getText(route)})}`)
const backCode = compile(`const handleBack = ${backHandler.getText(route)}`)

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const draft = (content: string): MarkdownDocState => ({
  status: 'ready',
  content: 'disk',
  localContent: content,
  baseVersion: 'v1',
  editable: true,
  isDirty: true
})
const tabs: MobileSessionTab[] = [
  {
    id: 'note',
    type: 'markdown',
    title: 'Note',
    relativePath: 'note.md',
    isActive: true
  }
]
type Source = { client: RpcClient; hostId: string; worktreeId: string; focused: boolean }
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})

async function harness() {
  const clipboardWrites: ReturnType<typeof deferred>[] = []
  const clipboard = vi.fn(() => {
    const write = deferred()
    clipboardWrites.push(write)
    return write.promise
  })
  const back = vi.fn()
  const router = { canGoBack: () => true, back, replace: vi.fn() }
  const errors = vi.fn()
  const source: Source = {
    client: {} as RpcClient,
    hostId: 'host-a',
    worktreeId: 'wt-a',
    focused: true
  }
  let renderer: ReactTestRenderer | null = null
  let current!: {
    requestLeave: () => void
    edit: (content: string) => void
    onBack: () => boolean
    visible: boolean
  }
  function Harness(props: Source) {
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
    const [markdownDocs, setMarkdownDocs] = useState(
      new Map<string, MarkdownDocState>([['note', draft('draft wt-a')]])
    )
    const markdownDocsRef = useRef(markdownDocs)
    const sessionTabsRef = useRef(tabs)
    markdownDocsRef.current = markdownDocs
    const updateMarkdownLocalContent = bind<(tabId: string, content: string) => void>(
      editCode,
      'useMarkdownEdit',
      { useCallback, setMarkdownDocs, markdownDocsRef }
    )()
    useEffect(() => {
      setDocumentScope({ hostId: props.hostId, worktreeId: props.worktreeId })
      setMarkdownDocs(new Map([['note', draft(`draft ${props.worktreeId}`)]]))
    }, [props.hostId, props.worktreeId])
    const useFocusEffect = (callback: () => void | (() => void)) => {
      useEffect(() => (props.focused ? callback() : undefined), [callback, props.focused])
    }
    const {
      leaveFocusToken,
      leaveFocusTokenRef,
      leavePromptTokenRef,
      leaveCopyIntentRef,
      isCurrentLeaveSource
    } = bind<{
      leaveFocusToken: object | null
      leaveFocusTokenRef: React.RefObject<object | null>
      leavePromptTokenRef: React.RefObject<object | null>
      leaveCopyIntentRef: React.RefObject<object | null>
      isCurrentLeaveSource: () => boolean
    }>(ownerCode, 'useLeaveOwner', {
      useState,
      useRef,
      useCallback,
      useLayoutEffect,
      useFocusEffect,
      createFeedbackSource,
      documentScopeActive
    })()
    const { leaveDraftsState, leaveDrafts, setLeaveDrafts } = bind<{
      leaveDraftsState: object | null
      leaveDrafts: object | null
      setLeaveDrafts: (drafts: unknown, token?: object) => void
    }>(promptCode, 'useLeavePrompt', {
      useState,
      useRef,
      useCallback,
      createFeedbackSource,
      documentScopeActive,
      leaveFocusTokenRef,
      leavePromptTokenRef,
      leaveCopyIntentRef,
      isCurrentLeaveSource,
      leaveFocusToken
    })()
    const { requestLeaveSession, handleCopyDraftsAndLeave, handleDiscardDraftsAndLeave } = bind<{
      requestLeaveSession: () => void
      handleCopyDraftsAndLeave: () => void
      handleDiscardDraftsAndLeave: () => void
    }>(actionCode, 'useLeaveActions', {
      useCallback,
      markdownDocs,
      sessionTabs: tabs,
      router,
      hostId: props.hostId,
      isCurrentLeaveSource,
      setLeaveDrafts,
      leaveDraftsState,
      leaveDrafts,
      leaveFocusTokenRef,
      leavePromptTokenRef,
      leaveCopyIntentRef,
      markdownDocsRef,
      sessionTabsRef,
      collectDirtyMobileMarkdownDrafts,
      copyMobileMarkdownDraftsBeforeLeave,
      Clipboard: { setStringAsync: clipboard },
      Keyboard: { dismiss: vi.fn() },
      triggerError: errors,
      showToast: errors
    })()
    const renderLeaveModal = bind<() => React.ReactElement>(modalCode, 'renderLeaveModal', {
      createElement,
      ActionSheetModal,
      leaveDrafts,
      leaveDraftsState,
      setLeaveDrafts,
      handleCopyDraftsAndLeave,
      handleDiscardDraftsAndLeave,
      FileText: 'FileText'
    })
    const onBack = bind<() => boolean>(backCode, 'handleBack', {
      isCurrentLeaveSource,
      activePanel: null,
      keyboardHeight: 0,
      resolveSessionBackAction: () => 'leave-session',
      dismissSoftwareKeyboard: vi.fn(),
      setActivePanel: vi.fn(),
      requestLeaveSession
    })
    current = {
      requestLeave: requestLeaveSession,
      edit: (content) => updateMarkdownLocalContent('note', content),
      onBack,
      visible: leaveDrafts !== null
    }
    return renderLeaveModal()
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
    back,
    clipboard,
    clipboardWrites,
    errors,
    render,
    get: () => current,
    modal: () => renderer!.root.findByType(ActionSheetModal),
    press: (index: number) => renderer!.root.findAllByType('Pressable')[index]!.props.onPress(),
    pressCallback: (index: number) =>
      renderer!.root.findAllByType('Pressable')[index]!.props.onPress as () => void,
    unmount: () => {
      act(() => renderer!.unmount())
      renderers.delete(renderer!)
    }
  }
}

describe('actual Session route markdown leave lifecycle', () => {
  it('keeps auto-close from cancelling a current copy, then leaves after clipboard success', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    expect(h.get().visible).toBe(true)
    act(() => h.press(0))
    expect(h.clipboard).toHaveBeenCalledWith('# Note\n\ndraft wt-a')
    expect(h.get().visible).toBe(false)
    expect(h.back).not.toHaveBeenCalled()
    await act(async () => h.clipboardWrites[0]!.resolve())
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('retains a new edit while copy is pending and offers the newer draft again', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    act(() => h.press(0))
    act(() => h.get().edit('newer draft'))
    await act(async () => h.clipboardWrites[0]!.resolve())
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
    act(() => h.press(0))
    expect(h.clipboard).toHaveBeenLastCalledWith('# Note\n\nnewer draft')
    await act(async () => h.clipboardWrites[1]!.resolve())
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('does not leave when a new edit and clipboard receipt share one React batch', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    act(() => h.press(0))
    await act(async () => {
      h.get().edit('newer draft')
      h.clipboardWrites[0]!.resolve()
      await Promise.resolve()
    })
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
  })

  it('prompts when a clean document is edited just before Back in one React batch', async () => {
    const h = await harness()
    act(() => h.get().edit('disk'))
    act(() => {
      h.get().edit('new unsaved draft')
      h.get().requestLeave()
    })
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
    expect(h.modal().props.actions[0].label).toBe('Copy All & Leave')
  })

  it('claims Copy synchronously across two presses in one React batch', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    const copy = h.pressCallback(0)
    act(() => {
      copy()
      copy()
    })
    expect(h.clipboard).toHaveBeenCalledTimes(1)
    await act(async () => h.clipboardWrites[0]!.resolve())
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('does not report an old clipboard rejection to the new workspace', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    act(() => h.press(0))
    await h.render({ worktreeId: 'wt-b' })
    await act(async () => h.clipboardWrites[0]!.reject(new Error('Clipboard unavailable')))
    expect(h.errors).not.toHaveBeenCalled()
    expect(h.back).not.toHaveBeenCalled()
  })

  it.each(['worktree', 'ABA', 'client', 'blur', 'blur-refocus', 'unmount'] as const)(
    'does not leave a changed or retained route after %s during copy',
    async (change) => {
      const h = await harness()
      act(() => h.get().requestLeave())
      act(() => h.press(0))
      if (change === 'unmount') {
        h.unmount()
      } else if (change === 'client') {
        await h.render({ client: {} as RpcClient })
      } else if (change === 'worktree' || change === 'ABA') {
        await h.render({ worktreeId: 'wt-b' })
        if (change === 'ABA') {
          await h.render()
        }
      } else {
        await h.render({ focused: false })
        if (change === 'blur-refocus') {
          await h.render()
        }
      }
      await act(async () => h.clipboardWrites[0]!.resolve())
      expect(h.back).not.toHaveBeenCalled()
    }
  )

  it('keeps stale Copy, Discard and onClose callbacks out of the new prompt', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    const old = h.modal().props
    await h.render({ worktreeId: 'wt-b' })
    act(() => h.get().requestLeave())
    expect(h.get().visible).toBe(true)
    act(() => {
      old.actions[0].onPress()
      old.actions[1].onPress()
      old.onClose()
    })
    expect(h.clipboard).not.toHaveBeenCalled()
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
    act(() => h.press(1))
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('retires cancelled callbacks when the same source opens a new prompt', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    const old = h.modal().props
    act(() => old.onClose())
    expect(h.get().visible).toBe(false)
    act(() => h.get().requestLeave())
    expect(h.get().visible).toBe(true)
    act(() => {
      old.actions[0].onPress()
      old.actions[1].onPress()
      old.onClose()
    })
    expect(h.clipboard).not.toHaveBeenCalled()
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
    act(() => h.press(0))
    await act(async () => h.clipboardWrites[0]!.resolve())
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('does not let the old copy acknowledgment leave after the prompt reopens', async () => {
    const h = await harness()
    act(() => h.get().requestLeave())
    act(() => h.press(0))
    act(() => h.get().requestLeave())
    expect(h.get().visible).toBe(true)
    await act(async () => h.clipboardWrites[0]!.resolve())
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(true)
    act(() => h.press(0))
    await act(async () => h.clipboardWrites[1]!.resolve())
    expect(h.back).toHaveBeenCalledOnce()
  })

  it('lets the pushed screen handle Back while the Session route is blurred', async () => {
    const h = await harness()
    act(() => expect(h.get().onBack()).toBe(true))
    expect(h.get().visible).toBe(true)
    await h.render({ focused: false })
    expect(h.get().onBack()).toBe(false)
    expect(h.back).not.toHaveBeenCalled()
    expect(h.get().visible).toBe(false)
  })
})
