import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileBrowserTabCreation } from '../browser/use-mobile-browser-tab-creation'
import {
  MobileBrowserTabActionSheet,
  type MobileBrowserNavigationMethod
} from './MobileBrowserTabActionSheet'
import type { MobileSessionTab } from './mobile-session-route-types'
import { MobileSessionTabsStreamHealth } from './mobile-session-tabs-stream-health'

vi.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  ChevronRight: () => null,
  RefreshCw: () => null
}))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: object) => createElement('ActionSheetFixture', props)
}))

function compileActualFunction(url: URL, name: string): string {
  const source = ts.createSourceFile(
    url.href,
    readFileSync(url, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const matches: ts.FunctionDeclaration[] = []
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      matches.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (matches.length !== 1) {
    throw new Error(`Expected the actual ${name} declaration`)
  }
  return transformSync(matches[0].getText(source), {
    loader: 'tsx',
    format: 'esm',
    sourcefile: url.pathname
  }).code
}
const routeUrl = new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url)
const navigationCode = compileActualFunction(routeUrl, 'handleBrowserNavigationCommand')
const targetGuardCode = ['isCurrentTabCloseScope', 'isCurrentTabCloseTarget']
  .map((name) => compileActualFunction(routeUrl, name))
  .join('\n')
const publisherCode = compileActualFunction(
  new URL('../../../src/renderer/src/runtime/sync-runtime-graph.ts', import.meta.url),
  'buildMobileBrowserTab'
)
type BrowserTab = Extract<MobileSessionTab, { type: 'browser' }>
const publish = new Function(`${publisherCode};return buildMobileBrowserTab`)() as (
  inputs: unknown,
  workspace: unknown
) => BrowserTab
const pages = ['page-a', 'page-b'].map((id) => ({
  id,
  title: id,
  url: `https://${id}.example`,
  canGoBack: true,
  canGoForward: true
}))
function publishedTab(activePageId: string): BrowserTab {
  return publish(
    {
      pagesByBrowserWorkspaceId: new Map([['browser-workspace', pages]]),
      activeBrowserWorkspaceId: 'browser-workspace',
      certificateFailureByBrowserPageId: new Map()
    },
    { id: 'browser-workspace', activePageId }
  )
}
const pageA = publishedTab('page-a')
const pageB = publishedTab('page-b')
const success = { ok: true, result: {} }
function deferred() {
  let resolve!: (response: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
type Source = Pick<
  Parameters<typeof useMobileBrowserTabCreation>[0],
  'client' | 'hostId' | 'worktreeId' | 'connState'
>
type HarnessProps = Source & { tab: BrowserTab | null; navigateAtCommit?: boolean }
const renderers = new Set<ReactTestRenderer>()
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers.clear()
})

async function harness() {
  const response = deferred()
  const sendRequest = vi.fn((method: string) =>
    method === 'session.tabs.list'
      ? Promise.resolve({ ok: true, result: { tabs: [] } })
      : response.promise
  )
  const source: Source = {
    client: { sendRequest } as unknown as RpcClient,
    hostId: 'host-a',
    worktreeId: 'wt-a',
    connState: 'connected'
  }
  const timers: { action: () => void; delay: number }[] = []
  const fetchInvocations = vi.fn()
  const commitProbes: { currentSource: boolean; documentScopeActive: boolean }[] = []
  let renderer: ReactTestRenderer | null = null
  let current: { toast: string | null; target: BrowserTab | null; openMenu: () => void }
  function Harness(props: HarnessProps) {
    const [target, setTarget] = useState<BrowserTab | null>(null)
    const [toast, showToast] = useState<string | null>(null)
    const sessionTabsRef = useRef<MobileSessionTab[]>([])
    sessionTabsRef.current = props.tab ? [props.tab] : []
    const connStateRef = useRef(props.connState)
    connStateRef.current = props.connState
    const clientRef = useRef(props.client)
    clientRef.current = props.client
    const [documentScope, setDocumentScope] = useState({
      hostId: props.hostId,
      worktreeId: props.worktreeId
    })
    const documentScopeRef = useRef(documentScope)
    documentScopeRef.current = documentScope
    const documentReadScopeSeqRef = useRef(0)
    const documentScopeActive =
      documentScope.hostId === props.hostId && documentScope.worktreeId === props.worktreeId
    const controller = useMemo(
      () =>
        new MobileSessionTabsStreamHealth({
          client: props.client!,
          scope: `id:${props.worktreeId}`,
          apply: () => ({ accepted: true, effectiveTabs: [] }),
          consumeAccepted: () => {},
          hasRecoveryNeed: () => false
        }),
      [props.client, props.worktreeId]
    )
    useEffect(() => {
      controller.setReconciliationActive(true)
      return () => {
        controller.dispose()
        timers.length = 0
      }
    }, [controller])
    useEffect(() => {
      setDocumentScope({ hostId: props.hostId, worktreeId: props.worktreeId })
      documentReadScopeSeqRef.current += 1
      setTarget(null)
      return () => {
        documentReadScopeSeqRef.current += 1
      }
    }, [props.hostId, props.worktreeId])
    const fetchSessionTabs = () => {
      fetchInvocations()
      return controller.requestReconciliation()
    }
    const scheduleDelayedAction = (action: () => void, delay: number) => {
      timers.push({ action, delay })
    }
    const browserCreation = useMobileBrowserTabCreation({
      ...props,
      browserScreencastSupportedRef: { current: true },
      pendingBrowserFocusPageIdRef: { current: null },
      fetchSessionTabs,
      fetchPendingBrowserSessionTabs: fetchSessionTabs,
      scheduleDelayedAction,
      setCreateError: () => {},
      showToast,
      setShowCreateBrowserModal: () => {}
    })
    const dependencies = {
      client: props.client,
      worktreeId: props.worktreeId,
      connStateRef,
      clientRef,
      documentScope,
      documentScopeRef,
      documentScopeActive,
      documentReadScopeSeqRef,
      tabCloseScopeSeq: documentReadScopeSeqRef.current,
      isCurrentBrowserSource: browserCreation.isCurrentSource,
      sessionTabsRef,
      showToast,
      scheduleDelayedAction,
      fetchSessionTabs
    }
    const navigate = new Function(
      ...Object.keys(dependencies),
      `${targetGuardCode}\n${navigationCode};return handleBrowserNavigationCommand`
    )(...Object.values(dependencies)) as (
      tab: BrowserTab,
      method: MobileBrowserNavigationMethod
    ) => Promise<void>
    useLayoutEffect(() => {
      if (props.navigateAtCommit && target) {
        commitProbes.push({ currentSource: browserCreation.isCurrentSource(), documentScopeActive })
        void navigate(target, 'browser.reload')
      }
    }, [props.navigateAtCommit, props.hostId, props.worktreeId])
    current = { toast, target, openMenu: () => setTarget(props.tab) }
    return createElement(MobileBrowserTabActionSheet, {
      target,
      onClose: () => setTarget(null),
      onNavigate: navigate,
      onCloseTab: () => {}
    })
  }
  async function render(change: Partial<HarnessProps> = {}) {
    await act(async () => {
      const element = createElement(Harness, { ...source, tab: pageA, ...change })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
        renderers.add(renderer)
      }
    })
  }
  function unmount() {
    if (renderer) {
      const mounted = renderer
      act(() => mounted.unmount())
      renderers.delete(mounted)
      renderer = null
    }
  }
  await render()
  act(() => current!.openMenu())
  return {
    response,
    sendRequest,
    timers,
    fetchInvocations,
    commitProbes,
    render,
    unmount,
    get: () => current!,
    action(label = 'Reload'): () => void {
      const actions = renderer!.root.findByType('ActionSheetFixture').props.actions as {
        label: string
        onPress: () => void
      }[]
      const action = actions.find((candidate) => candidate.label === label)
      if (!action) {
        throw new Error(`Actual browser menu is missing ${label}`)
      }
      return action.onPress
    }
  }
}

describe('actual Browser tab menu navigation lifecycle', () => {
  it('rejects a new source handler while the first committed render still has old tab data', async () => {
    const h = await harness()
    await h.render({ worktreeId: 'wt-b', navigateAtCommit: true })
    expect(h.commitProbes).toEqual([{ currentSource: true, documentScopeActive: false }])
    expect(h.sendRequest).not.toHaveBeenCalled()
  })

  it('does not queue a current menu request while disconnected', async () => {
    const h = await harness()
    await h.render({ connState: 'disconnected' })
    await act(async () => h.action()())
    expect(h.sendRequest).not.toHaveBeenCalled()
  })

  it.each(['replaced page', 'removed tab'])(
    'rejects the old menu target after the host publishes a %s',
    async (change) => {
      const h = await harness()
      expect(pageB.id).toBe(pageA.id)
      expect(pageB.browserPageId).not.toBe(pageA.browserPageId)
      await h.render({ tab: change === 'removed tab' ? null : pageB })
      expect(h.get().target?.browserPageId).toBe('page-a')
      await act(async () => h.action()())
      expect(h.sendRequest).not.toHaveBeenCalled()
      expect(h.get().toast).toBeNull()
    }
  )

  it.each(['worktree', 'client', 'disconnect', 'unmount', 'ABA'])(
    'rejects a queued old menu callback after %s',
    async (change) => {
      const h = await harness()
      const oldPress = h.action()
      if (change === 'unmount') {
        h.unmount()
      } else if (change === 'client') {
        await h.render({ client: { sendRequest: vi.fn() } as unknown as RpcClient })
      } else if (change === 'disconnect') {
        await h.render({ connState: 'disconnected' })
      } else {
        await h.render({ worktreeId: 'wt-b' })
        if (change === 'ABA') {
          await h.render()
        }
      }
      await act(async () => oldPress())
      expect(h.sendRequest).not.toHaveBeenCalled()
      expect(h.get().toast).toBeNull()
    }
  )

  it.each(['worktree', 'page'])(
    'keeps a dispatched old failure out of the new %s',
    async (change) => {
      const h = await harness()
      await act(async () => h.action()())
      expect(h.sendRequest).toHaveBeenCalledTimes(1)
      await h.render(change === 'page' ? { tab: pageB } : { worktreeId: 'wt-b' })
      await act(async () => {
        h.response.reject(new Error('A navigation failed'))
        await Promise.resolve()
      })
      expect(h.get().toast).toBeNull()
    }
  )

  it('does not schedule post-unmount refresh, while the disposed controller also prevents extra RPC', async () => {
    const h = await harness()
    await act(async () => h.action()())
    h.unmount()
    await act(async () => {
      h.response.resolve(success)
      await Promise.resolve()
    })
    await act(async () => {
      h.timers.forEach((timer) => timer.action())
      await Promise.resolve()
    })
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
    expect(h.timers).toEqual([])
  })

  it('rechecks the target when an accepted navigation refresh timer executes', async () => {
    const h = await harness()
    await act(async () => h.action()())
    await act(async () => {
      h.response.resolve(success)
      await Promise.resolve()
    })
    expect(h.timers.map((timer) => timer.delay)).toEqual([250])
    await h.render({ tab: pageB })
    await act(async () => {
      h.timers[0].action()
      await Promise.resolve()
    })
    expect(h.fetchInvocations).not.toHaveBeenCalled()
    expect(h.sendRequest).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Back', 'browser.back'],
    ['Forward', 'browser.forward'],
    ['Reload', 'browser.reload']
  ])(
    'preserves %s after the menu closes, including same-page snapshot updates',
    async (label, method) => {
      const h = await harness()
      await h.render({ tab: { ...pageA, title: 'Updated title' } })
      await act(async () => h.action(label)())
      expect(h.get().target).toBeNull()
      expect(h.sendRequest).toHaveBeenCalledExactlyOnceWith(
        method,
        { worktree: 'id:wt-a', page: 'page-a' },
        { timeoutMs: 15_000 }
      )
      await act(async () => {
        h.response.resolve(success)
        await Promise.resolve()
      })
      expect(h.timers.map((timer) => timer.delay)).toEqual([250])
      await act(async () => {
        h.timers[0].action()
        await Promise.resolve()
      })
      expect(h.fetchInvocations).toHaveBeenCalledTimes(1)
      expect(h.sendRequest).toHaveBeenLastCalledWith('session.tabs.list', { worktree: 'id:wt-a' })
    }
  )
})
