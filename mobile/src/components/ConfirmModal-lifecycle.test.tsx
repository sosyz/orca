import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmModal } from './ConfirmModal'
import { BottomDrawer } from './BottomDrawer'

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('./mounted-bottom-drawer', () => ({
  MountedBottomDrawer: ({ children }: { children: React.ReactNode }) => children
}))

const route = ts.createSourceFile(
  'route.tsx',
  readFileSync(new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let discardCode = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmDiscardMarkdown') {
    discardCode = node.getText(route)
  }
  ts.forEachChild(node, visit)
}
visit(route)
if (!discardCode) {
  throw new Error('Actual confirmDiscardMarkdown handler not found')
}
const compiledDiscard = transformSync(discardCode, { loader: 'tsx', format: 'esm' }).code

type Target = { tab: { id: string }; action: 'close' | 'refresh'; scopeSeq: number }

describe('ConfirmModal committed opening lifecycle', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(action: Target['action'] = 'refresh') {
    const readMarkdownTab = vi.fn()
    const handleCloseSessionTab = vi.fn()
    const clearMobileSessionDocumentRead = vi.fn()
    const events: string[] = []
    let currentTarget: Target | null = null
    let setTarget!: (target: Target | null) => void
    let rerender!: () => void
    function Harness() {
      const [target, updateTarget] = useState<Target | null>({
        tab: { id: 'draft-A' },
        action,
        scopeSeq: 1
      })
      const [, setRevision] = useState(0)
      currentTarget = target
      setTarget = updateTarget
      rerender = () => setRevision((value) => value + 1)
      const deps = {
        discardMarkdownTarget: target,
        setDiscardMarkdownTarget: updateTarget,
        documentReadScopeSeqRef: { current: 1 },
        documentReadRequestsRef: { current: {} },
        clearMobileSessionDocumentRead,
        readMarkdownTab,
        handleCloseSessionTab
      }
      const confirmDiscardMarkdown = new Function(
        ...Object.keys(deps),
        `${compiledDiscard};return confirmDiscardMarkdown`
      )(...Object.values(deps)) as () => void
      return createElement(ConfirmModal, {
        visible: target !== null,
        title: 'Discard draft?',
        destructive: true,
        onConfirm: () => {
          events.push('confirm')
          confirmDiscardMarkdown()
        },
        onCancel: () => {
          events.push('cancel')
          updateTarget(null)
        }
      })
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    return {
      readMarkdownTab,
      handleCloseSessionTab,
      clearMobileSessionDocumentRead,
      events,
      cancel: () => renderer!.root.findAllByType('Pressable')[0]!.props.onPress as () => void,
      confirm: () => renderer!.root.findAllByType('Pressable')[1]!.props.onPress as () => void,
      drawerClose: () => renderer!.root.findByType(BottomDrawer).props.onClose as () => void,
      open: (id = 'draft-B') => setTarget({ tab: { id }, action, scopeSeq: 1 }),
      target: () => currentTarget,
      rerender: () => rerender()
    }
  }

  it.each(['refresh', 'close'] as const)(
    'does not discard or close a draft after Cancel with queued %s confirmation',
    (action) => {
      const modal = mount(action)
      const queuedConfirm = modal.confirm()
      act(() => {
        modal.cancel()()
        queuedConfirm()
      })
      expect(modal.readMarkdownTab).not.toHaveBeenCalled()
      expect(modal.handleCloseSessionTab).not.toHaveBeenCalled()
      expect(modal.clearMobileSessionDocumentRead).not.toHaveBeenCalled()
      expect(modal.events).toEqual(['cancel'])
      // The real BottomDrawer retains its children until the close animation finishes.
      expect(renderer!.root.findAllByType('Pressable')).toHaveLength(2)
      act(() => modal.confirm()())
      expect(modal.events).toEqual(['cancel'])
    }
  )

  it('executes one confirmation before cancellation for two queued presses', () => {
    const modal = mount()
    const confirm = modal.confirm()
    act(() => {
      confirm()
      confirm()
    })
    expect(modal.readMarkdownTab).toHaveBeenCalledExactlyOnceWith(
      { id: 'draft-A' },
      { preserveDirty: false }
    )
    expect(modal.events).toEqual(['confirm', 'cancel'])
  })

  it.each([false, true])('isolates callbacks after reopening (batched=%s)', (batched) => {
    const modal = mount()
    const oldConfirm = modal.confirm()
    const oldCancel = modal.cancel()
    act(() => {
      oldCancel()
      if (batched) {
        modal.open()
      }
    })
    if (!batched) {
      act(() => modal.open())
    }
    act(() => {
      oldConfirm()
      oldCancel()
    })
    expect(modal.target()?.tab.id).toBe('draft-B')
    expect(modal.readMarkdownTab).not.toHaveBeenCalled()
    act(() => modal.confirm()())
    expect(modal.readMarkdownTab).toHaveBeenCalledExactlyOnceWith(
      { id: 'draft-B' },
      { preserveDirty: false }
    )
  })

  it('retires queued confirmation when the drawer dismisses', () => {
    const modal = mount()
    const confirm = modal.confirm()
    act(() => modal.drawerClose()())
    act(() => confirm())
    expect(modal.readMarkdownTab).not.toHaveBeenCalled()
    expect(modal.events).toEqual(['cancel'])
  })

  it('preserves valid callbacks across an ordinary rerender', () => {
    const modal = mount()
    const confirm = modal.confirm()
    act(() => modal.rerender())
    act(() => confirm())
    expect(modal.readMarkdownTab).toHaveBeenCalledExactlyOnceWith(
      { id: 'draft-A' },
      { preserveDirty: false }
    )
    expect(modal.events).toEqual(['confirm', 'cancel'])
  })

  it('ignores callbacks after unmount', () => {
    const modal = mount()
    const confirm = modal.confirm()
    const cancel = modal.cancel()
    act(() => renderer!.unmount())
    renderer = null
    act(() => {
      confirm()
      cancel()
    })
    expect(modal.readMarkdownTab).not.toHaveBeenCalled()
    expect(modal.events).toEqual([])
  })
})
