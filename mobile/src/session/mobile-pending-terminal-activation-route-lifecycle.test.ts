import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { SessionTabsApplyOutcome } from './mobile-session-tabs-stream-health'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { createElement, useEffect, useMemo, useState, useCallback } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { it, expect, vi } from 'vitest'
import { useMobilePendingTerminalActivation } from './use-mobile-pending-terminal-activation'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'
import * as snapshotGate from './session-tab-snapshot-gate'
import * as records from './mobile-terminal-records'
import * as documents from './mobile-session-document-refresh'
import { resolveActiveSessionTab } from './active-session-tab'
import { getActiveTabIdForHandle } from './mobile-session-route-helpers'
import { MobileSessionTabsStreamHealth } from './mobile-session-tabs-stream-health'
const route = ts.createSourceFile(
  'route.tsx',
  readFileSync(new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let applyCode = ''
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.name.getText(route) === 'applySessionTabs') {
    applyCode = n.initializer!.getText(route)
  }
  ts.forEachChild(n, visit)
}
visit(route)
if (!applyCode) {
  throw new Error('Actual applySessionTabs callback not found')
}
function compile(code: string, deps: object) {
  return new Function(
    ...Object.keys(deps),
    transformSync('function fixture(){' + code + '}', { loader: 'tsx', format: 'esm' }).code +
      ';return fixture()'
  )(...Object.values(deps))
}
const ref = <T>(current: T) => ({ current })
const terminal = (id: string, handle: string | null): MobileSessionTab => ({
  id,
  type: 'terminal',
  title: id,
  terminal: handle,
  isActive: true
})
const snap = (id: string, version: number): SessionTabsResult => ({
  worktree: id,
  activeTabId: id,
  activeTabType: 'terminal',
  publicationEpoch: 'same-host-publisher',
  snapshotVersion: version,
  tabs: [terminal(id, `term-${id}`)]
})
function stateSetter(holder: Record<string, unknown>, key: string) {
  return (value: unknown) => {
    holder[key] = typeof value === 'function' ? value(holder[key]) : value
  }
}
async function harness() {
  let finish!: (r: RpcResponse) => void
  const pending = new Promise<RpcResponse>((done) => {
    finish = done
  })
  const calls: [string, unknown][] = []
  const timers: { action: () => void; delay: number }[] = []
  const subscribed: string[] = []
  const client = {
    sendRequest: vi.fn((method: string, params: unknown) => {
      calls.push([method, params])
      return method === 'session.tabs.activate'
        ? pending
        : Promise.resolve({ ok: true, result: snap('B', 10) })
    })
  }
  let current = { tabs: [] as MobileSessionTab[] }
  const persistent = {
    terminalDiagnosticsRef: ref({ tabsApplied() {} }),
    appliedSnapshotMarkerRef: ref({ epoch: null, version: -1 }),
    appliedSessionTabsRevisionRef: ref(0),
    closedTabTombstonesRef: ref(new Map()),
    markdownDocsRef: ref(new Map()),
    sessionTabsRef: ref([]),
    activeSessionTabIdRef: ref<string | null>(null),
    documentReadRequestsRef: ref({ file: new Map(), markdown: new Map() }),
    markdownSaveRequestsRef: ref(new Map()),
    initialSessionAutoCreateRef: ref({ sawSessionTabs: false }),
    terminalsRef: ref([]),
    lastKnownTerminalCountRef: ref(0),
    pendingActiveSessionTabIdRef: ref<string | null>(null),
    selectedSessionTabIdRef: ref<string | null>(null),
    pendingActiveTerminalHandleRef: ref<string | null>(null),
    pendingBrowserFocusPageIdRef: ref<string | null>(null),
    activeSessionTabTypeRef: ref<string | null>(null),
    activeHandleRef: ref<string | null>(null),
    initializedHandlesRef: ref(new Set()),
    markdownDocs: new Map(),
    fileDocs: new Map(),
    terminals: [],
    activeId: null,
    activeHandle: null,
    defaultTerminalHandlesToLiveInput() {},
    unsubscribeTerminal() {},
    subscribeToTerminal: (h: string) => subscribed.push(h)
  }
  function Harness(props: { worktreeId: string; pending: boolean }) {
    const [tabs, setSessionTabs] = useState<MobileSessionTab[]>([])
    const owner = useMobileTerminalCreationOwner({
      client: client as unknown as RpcClient,
      hostId: 'host',
      worktreeId: props.worktreeId,
      connState: 'connected'
    })
    const deps = {
      ...persistent,
      ...snapshotGate,
      ...records,
      ...documents,
      resolveActiveSessionTab,
      getActiveTabIdForHandle,
      useCallback,
      setSessionTabs,
      setMarkdownDocs: stateSetter(persistent, 'markdownDocs'),
      setFileDocs: stateSetter(persistent, 'fileDocs'),
      setTerminals: stateSetter(persistent, 'terminals'),
      setActiveSessionTabId: stateSetter(persistent, 'activeId'),
      setActiveHandle: stateSetter(persistent, 'activeHandle'),
      setTerminalsLoaded() {}
    }
    const applySessionTabs = compile(`return ${applyCode}`, deps) as (
      result: SessionTabsResult
    ) => SessionTabsApplyOutcome<MobileSessionTab>
    const controller = useMemo(
      () =>
        new MobileSessionTabsStreamHealth({
          client: client as unknown as RpcClient,
          scope: `id:${props.worktreeId}`,
          apply: applySessionTabs,
          consumeAccepted() {},
          hasRecoveryNeed: () => false
        }),
      [props.worktreeId]
    )
    useEffect(() => {
      controller.setReconciliationActive(true)
      return () => controller.dispose()
    }, [controller])
    useEffect(() => {
      persistent.appliedSnapshotMarkerRef.current = { epoch: null, version: -1 }
      persistent.selectedSessionTabIdRef.current = null
      persistent.activeHandleRef.current = null
      applySessionTabs(snap(props.worktreeId, 10))
    }, [props.worktreeId])
    useMobilePendingTerminalActivation({
      client: client as unknown as RpcClient,
      connState: 'connected',
      worktreeId: props.worktreeId,
      activeSessionTab: props.pending ? terminal('A', null) : terminal('B', 'term-B'),
      isCurrentSource: owner.isCurrent,
      isCurrentDocumentScope: owner.isCurrent,
      applySessionTabs,
      fetchSessionTabs: () => controller.requestReconciliation(),
      scheduleDelayedAction: (action, delay) => timers.push({ action, delay })
    })
    current = { tabs }
    return null
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(Harness, { worktreeId: 'A', pending: true }))
  })
  return {
    renderer,
    update: async () =>
      act(async () => renderer.update(createElement(Harness, { worktreeId: 'B', pending: false }))),
    finish: async () =>
      act(async () =>
        finish({ id: 'activate', ok: true, result: snap('A', 20), _meta: { runtimeId: 'host' } })
      ),
    current: () => current,
    persistent,
    calls,
    timers,
    subscribed
  }
}
it('keeps B tabs and terminal when A activation settles across a reused route', async () => {
  const h = await harness()
  await h.update()
  expect(h.current().tabs.map((t) => t.id)).toEqual(['B'])
  const before = h.calls.length
  await h.finish()
  expect(h.current().tabs.map((t) => t.id)).toEqual(['B'])
  expect(h.persistent.activeHandleRef.current).toBe('term-B')
  expect(h.subscribed).toEqual(['term-A', 'term-B'])
  expect(h.timers).toEqual([])
  await act(async () => {
    for (const t of h.timers) {
      await t.action()
    }
  })
  expect(h.calls.length).toBe(before)
  act(() => h.renderer.unmount())
})
