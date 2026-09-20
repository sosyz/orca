import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)
const reconciliationHookSource = readFileSync(
  new URL('./use-mobile-session-tabs-reconciliation.ts', import.meta.url),
  'utf8'
)
const terminalInventoryRecoverySource = readFileSync(
  new URL('./use-mobile-terminal-inventory-recovery.ts', import.meta.url),
  'utf8'
)
const autoCreateHookSource = readFileSync(
  new URL('./use-initial-session-terminal-autocreate.ts', import.meta.url),
  'utf8'
)
const pendingActivationHookSource = readFileSync(
  new URL('./use-mobile-pending-terminal-activation.ts', import.meta.url),
  'utf8'
)

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('mobile session startup', () => {
  it('auto-creates one terminal for a newly created empty session', () => {
    expect(source).toContain('useWorktreeSessionTabsLoaded(worktreeId)')
    expect(source).toContain(
      'initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()'
    )

    const autoCreateCall = sliceBetween(
      'useInitialSessionTerminalAutoCreate({',
      'const connectionVerdict ='
    )
    expect(autoCreateCall).toContain('stateRef: initialSessionAutoCreateRef')
    expect(autoCreateCall).toContain(
      'consumeCreationRoute: () => router.setParams({ created: undefined })'
    )
    expect(autoCreateCall).toContain("newlyCreatedWorkspace: created === '1'")
    expect(autoCreateCall).toContain('visibleTabCount: visibleTabs.length')
    expect(autoCreateCall).toContain('createTerminal: () => void handleCreateTerminal()')

    expect(autoCreateHookSource).toContain('shouldAutoCreateInitialSessionTerminal({')
    expect(autoCreateHookSource).toContain('stateRef.current.autoCreatedForWorktree === worktreeId')
    expect(autoCreateHookSource).toContain('stateRef.current.autoCreatedForWorktree = worktreeId')
    expect(autoCreateHookSource).toContain("connState === 'connected'")
    expect(autoCreateHookSource).toContain('(visibleTabCount > 0 || activeHandle !== null)')
    // Why: both callbacks are re-created every render, so the effect must reach them
    // through useEffectEvent rather than deps or a render-time ref write.
    expect(autoCreateHookSource).toContain('useEffectEvent(args.consumeCreationRoute)')
    expect(autoCreateHookSource).toContain('useEffectEvent(args.createTerminal)')
    expect(autoCreateHookSource).toContain('consumeCreationRoute()')
    expect(autoCreateHookSource).toContain('createTerminal()')
  })

  it('arms the auto-create only until the route has published a tab (#9717)', () => {
    // Emptiness after a populated list is a close, not a cold hydrate.
    expect(source).toContain(
      'initialSessionAutoCreateRef.current.sawSessionTabs ||= nextTabs.length > 0'
    )

    const autoCreateCall = sliceBetween(
      'useInitialSessionTerminalAutoCreate({',
      'const connectionVerdict ='
    )
    expect(autoCreateCall).toContain('stateRef: initialSessionAutoCreateRef')
    expect(autoCreateHookSource).toContain('sawSessionTabs: stateRef.current.sawSessionTabs')
  })

  it('delegates stream ownership while retaining degraded polling and a certified sweep', () => {
    expect(source).toContain('useMobileSessionTabsReconciliation<')
    expect(source).toContain('const applicationRevision = ++appliedSessionTabsRevisionRef.current')
    expect(source).toContain('getApplicationRevision: getSessionTabsApplicationRevision')
    expect(source).not.toContain("client.subscribe(\n      'session.tabs.subscribe'")
    expect(reconciliationHookSource).toContain("client.subscribe(\n      'session.tabs.subscribe'")
    expect(reconciliationHookSource).toContain("if (AppState.currentState !== 'active')")
    expect(reconciliationHookSource).toContain('suspendTerminalInventoryRecovery(true)')
    expect(reconciliationHookSource).toContain('controller.poll()')
    expect(reconciliationHookSource).toContain('tabsRequest !== null')
    expect(reconciliationHookSource).toContain('void refreshTerminalInventory()')
    expect(reconciliationHookSource).toContain("AppState.addEventListener('change'")
    expect(reconciliationHookSource).toContain('const interval = setInterval(')
    expect(reconciliationHookSource).toContain('RECONCILIATION_INTERVAL_MS = 2000')
    expect(terminalInventoryRecoverySource).toContain('CERTIFIED_TERMINAL_SWEEP_MS = 60_000')
    expect(reconciliationHookSource).toContain('controller.setReconciliationActive(false)')
    expect(reconciliationHookSource).toContain('clearInterval(interval)')
    expect(reconciliationHookSource).toContain('appStateSubscription.remove()')
  })

  it('confirms terminal stream teardown with a committed inventory-recovery bridge', () => {
    expect(source).toContain("if (data.type === 'end' || data.type === 'error')")
    expect(source).toContain('signalTerminalInventoryRecovery()')
    expect(terminalInventoryRecoverySource).toContain('actionRef.current = recoveryAction')
    expect(terminalInventoryRecoverySource).toContain('pendingSignalScopeRef.current = scopeKey')
    expect(terminalInventoryRecoverySource).toContain(
      'committedScope !== null && committedScope !== scopeKey'
    )
    expect(source).toContain('return terminalInventoryRequest.activate()')
    expect(source).toContain('if (!isCurrent())')
    expect(terminalInventoryRecoverySource).toContain(
      'TERMINAL_INVENTORY_CONFIRMATION_DELAY_MS = 750'
    )
    expect(terminalInventoryRecoverySource).toContain(
      'refreshTerminalInventory({ allowEmptyLoaded: true })'
    )
  })

  it('hosts retained tab surfaces outside the mutually exclusive empty states', () => {
    expect(source).toContain('import { RetainedSessionBrowserSurfaces }')
    expect(source).toContain('import { RetainedSessionDocumentSurfaces }')
    expect(source).toContain('import { RetainedTerminalPaneHost }')
    const contentStart = source.indexOf('{showLoadingState ? (')
    const documentHostStart = source.indexOf('<RetainedSessionDocumentSurfaces', contentStart)
    const browserHostStart = source.indexOf('<RetainedSessionBrowserSurfaces', contentStart)
    const retainedHostStart = source.indexOf('<RetainedTerminalPaneHost', contentStart)
    const commandDockStart = source.indexOf('{/* Why: translate instead of resize', contentStart)
    expect(contentStart).toBeGreaterThanOrEqual(0)
    expect(documentHostStart).toBeGreaterThan(contentStart)
    expect(browserHostStart).toBeGreaterThan(documentHostStart)
    expect(retainedHostStart).toBeGreaterThan(browserHostStart)
    expect(commandDockStart).toBeGreaterThan(retainedHostStart)

    expect(source.slice(contentStart, documentHostStart)).not.toContain('<MobileMarkdownReader')
    expect(source.slice(contentStart, documentHostStart)).not.toContain('<MobileSessionFileReader')
    expect(source.slice(contentStart, documentHostStart)).not.toContain('<MobileBrowserPane')
    expect(source.slice(contentStart, retainedHostStart)).not.toContain('<TerminalPaneView')
    const documentHost = source.slice(documentHostStart, browserHostStart)
    expect(documentHost).toContain('activeTab={activeDocumentTab}')
    expect(documentHost).toContain('hiddenFrameStyle={styles.retainedSessionSurfaceHidden}')
    const browserHost = source.slice(browserHostStart, retainedHostStart)
    expect(browserHost).toContain('activeTab={activeBrowserTab}')
    expect(browserHost).toContain('hiddenFrameStyle={styles.retainedSessionSurfaceHidden}')
    const retainedHost = source.slice(retainedHostStart, commandDockStart)
    expect(retainedHost).toContain('visible={terminalSurfaceVisible}')
    expect(retainedHost).toContain('hiddenFrameStyle={styles.terminalFrameRetainedHidden}')
    expect(documentHost).toContain('key={`documents:${terminalInventoryRecoveryScope}`}')
    expect(browserHost).toContain('key={`browser:${terminalInventoryRecoveryScope}`}')
    expect(retainedHost).toContain('key={`terminal:${terminalInventoryRecoveryScope}`}')
    expect(source).toContain('!activeMarkdownTab &&')
    expect(source).toContain('!activeFileTab &&')
    expect(source).toContain('!activeBrowserTab &&')
    expect(source).toContain('!activePendingTerminalTab')
  })

  it('refreshes document tabs without replacing ready content with loading state', () => {
    const markdownRead = sliceBetween('const readMarkdownTab = useCallback(', 'const readFileTab =')
    expect(markdownRead).toContain('reserveMobileSessionDocumentRead(')
    expect(markdownRead).toContain('beginMarkdownTabRead(prev, tab.id)')
    expect(markdownRead).toContain('applyMarkdownTabReadSuccess(')
    expect(markdownRead).toContain('applyMarkdownDiskFallbackReadSuccess(')
    expect(markdownRead).toContain('applyMarkdownTabReadFailure(')
    expect(markdownRead).toContain('documentReadScopeSeqRef.current === requestScopeSeq')
    expect(markdownRead).toContain("connStateRef.current === 'connected'")
    expect(markdownRead).not.toContain('releaseMobileSessionDocumentRead(')
    expect(markdownRead).not.toContain("new Map(prev).set(tab.id, { status: 'loading' })")

    const fileRead = sliceBetween(
      'const readFileTab = useCallback(',
      'const copyDiffCommentsToClipboard ='
    )
    expect(fileRead).toContain('reserveMobileSessionDocumentRead(')
    expect(fileRead).toContain('beginFileTabRead(prev, tab.id)')
    expect(fileRead).toContain('applyFileTabReadSuccess(')
    expect(fileRead).toContain('applyFileTabReadFailure(')
    expect(fileRead).toContain('isCurrentMobileSessionDocumentRead(')
    expect(fileRead).not.toContain('releaseMobileSessionDocumentRead(')
    expect(fileRead).not.toContain("new Map(prev).set(tab.id, { status: 'loading' })")

    const discardRead = sliceBetween('function confirmDiscardMarkdown()', 'const saveMarkdownTab =')
    expect(discardRead).toContain(
      'clearMobileSessionDocumentRead(documentReadRequestsRef.current, target.tab.id)'
    )

    const markdownSave = sliceBetween(
      'const saveMarkdownTab = useCallback(',
      'const consumeAcceptedSessionTabs ='
    )
    expect(markdownSave).toContain(
      'clearMobileSessionDocumentRead(documentReadRequestsRef.current, tab.id)'
    )
  })

  it('preserves retained scrollback and fences delayed cold-start zoom reset', () => {
    const scrollbackBranch = sliceBetween(
      "if (data.type === 'scrollback') {",
      "} else if (data.type === 'metadata')"
    )
    expect(scrollbackBranch).toContain(
      'const wasRendered = terminalRenderedHandlesRef.current.has(handle)'
    )
    expect(scrollbackBranch).toContain('ref.init(cols, rows, initialData, wasRendered, oscLinks)')
    expect(scrollbackBranch).toContain('if (!wasRendered) {')
    expect(scrollbackBranch).toContain('if (getTerminalRef(handle) === ref')
    expect(scrollbackBranch).toContain('initializedHandlesRef.current.has(handle)')
    expect(scrollbackBranch).toContain('ref.resetZoom()')
  })

  it('loads session tabs without waiting for desktop activation', () => {
    const startupEffect = sliceBetween(
      'void (async () => {',
      'return () => {\n      disposed = true'
    )

    expect(startupEffect).toContain("void client\n          .sendRequest('worktree.activate'")
    expect(startupEffect).toContain("if (client && created !== '1' && !isFloatingWorkspaceRoute)")
    expect(startupEffect).toContain("if (client && created === '1' && !isFloatingWorkspaceRoute)")
    expect(startupEffect).toContain('notifyClients: false')
    expect(startupEffect).toContain("navigation: 'caller'")
    expect(startupEffect).not.toContain("await client\n          .sendRequest('worktree.activate'")
    expect(startupEffect.indexOf("sendRequest('worktree.activate'")).toBeLessThan(
      startupEffect.indexOf('await ensureSessionTabs()')
    )
    expect(startupEffect).toContain('headlessActivationNeedsHostRenderer(response.result)')
    expect(startupEffect).toContain("showToast('Open Orca on the host to wake sleeping agents.'")
  })

  it('fails runtime capability gates closed before probing a replacement client', () => {
    const capabilityEffect = sliceBetween(
      'const hostQueryReplyInputSupportedRef = useRef(false)',
      '// Why: read deviceToken from host record'
    )
    const probeStart = capabilityEffect.indexOf('startRuntimeCapabilityProbe(client,')

    expect(probeStart).toBeGreaterThanOrEqual(0)
    for (const reset of [
      'setBrowserScreencastSupported(null)',
      'setAgentSessionHistorySupported(null)',
      'setQuickCommandsSupported(null)',
      'setShowQuickCommands(false)',
      'hostQueryReplyInputSupportedRef.current = false'
    ]) {
      const resetIndex = capabilityEffect.lastIndexOf(reset)
      expect(resetIndex).toBeGreaterThanOrEqual(0)
      expect(resetIndex).toBeLessThan(probeStart)
    }
  })

  it('activates an already-selected pending terminal tab after hydration', () => {
    const pendingActivationCall = sliceBetween(
      'useMobilePendingTerminalActivation({',
      'const showLoadingState ='
    )
    for (const binding of [
      'activeSessionTab,',
      'applySessionTabs,',
      'client,',
      'connState,',
      'fetchSessionTabs,',
      'isCurrentDocumentScope: isCurrentTabCloseScope,',
      'isCurrentSource: terminalCreation.isCurrent,',
      'scheduleDelayedAction,',
      'worktreeId'
    ]) {
      expect(pendingActivationCall).toContain(binding)
    }
    expect(pendingActivationHookSource).toContain(
      "if (!client || connState !== 'connected' || !target || ready)"
    )
    expect(pendingActivationHookSource).toContain(
      'attemptRef.current?.target === target && attemptRef.current.isCurrent()'
    )
    expect(pendingActivationHookSource).toContain('tabId: target.tabId')
    expect(pendingActivationHookSource).toContain('leafId: target.leafId')
    expect(pendingActivationHookSource).toContain('{ isCurrent: isCurrentAttempt }')
    expect(pendingActivationHookSource).toContain('if (!isCurrentAttempt())')
    expect(pendingActivationHookSource).toContain(
      'args.applySessionTabs(response.result as SessionTabsResult)'
    )
    expect(pendingActivationHookSource).toContain('for (const delay of [300, 1200])')
    expect(pendingActivationHookSource).toContain('args.scheduleDelayedAction(() => {')
    expect(pendingActivationHookSource).toContain('if (isCurrent())')
    expect(pendingActivationHookSource).toContain('void args.fetchSessionTabs()')
  })

  it('keeps ready terminal taps local while publishing caller selection', () => {
    const readyTerminalSwitch = sliceBetween(
      'const switchTab = useCallback(',
      'const switchSessionTab = useCallback('
    )

    expect(readyTerminalSwitch).not.toContain('focusMobileTerminal(client, handle)')
    expect(readyTerminalSwitch).toContain('activateMobileSessionTab(client,')
    expect(readyTerminalSwitch).toContain('notifyClients: false')
    expect(readyTerminalSwitch).toContain("navigation: 'caller'")
  })

  it('keeps background and pending session-tab activation local to the phone', () => {
    function activationParams(text: string): string[] {
      const tree = ts.createSourceFile(
        'source.tsx',
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const params: string[] = []
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(tree) === 'activateMobileSessionTab'
        ) {
          expect(node.arguments[0]?.getText(tree)).toBe('client')
          params.push(node.arguments[1]?.getText(tree) ?? '')
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
      return params
    }
    const pendingRequests = activationParams(pendingActivationHookSource)
    const activationRequests = [...activationParams(source), ...pendingRequests]

    expect(pendingRequests).toHaveLength(1)
    expect(activationRequests).toHaveLength(4)
    for (const request of activationRequests) {
      expect(request).toContain('notifyClients: false')
      expect(request).toContain("navigation: 'caller'")
      expect(request).toContain("intent: 'user'")
    }
  })

  it('keeps dynamic agent rows above fixed New Tab actions', () => {
    const newTabActions = sliceBetween('title="New Tab"', 'onClose={() => setShowCreateTabDrawer')

    expect(newTabActions.indexOf('...createTabAgentActions')).toBeLessThan(
      newTabActions.indexOf("label: 'Terminal'")
    )
    expect(newTabActions.indexOf("label: 'Terminal'")).toBeLessThan(
      newTabActions.indexOf("label: 'Browser'")
    )
    expect(newTabActions.indexOf("label: 'Browser'")).toBeLessThan(
      newTabActions.indexOf("label: 'Markdown Note'")
    )
  })

  it('wires pending-handle recovery through its bounded context (STA-4256)', () => {
    const applySessionTabs = sliceBetween(
      'const applySessionTabs = useCallback(',
      'const consumeAcceptedSessionTabs = useCallback('
    )
    const recoveryContext = sliceBetween(
      'const pendingTerminalRecoveryContextCache = useMemo(',
      'const getSessionTabsApplicationRevision'
    )

    const tabsRefWrite = 'sessionTabsRef.current = nextTabs'
    const tabsStateWrite = 'setSessionTabs((prev)'
    const activeRefWrite = 'activeSessionTabIdRef.current = active?.id ?? null'
    const activeStateWrite = 'setActiveSessionTabId(active?.id ?? null)'
    for (const write of [tabsRefWrite, tabsStateWrite, activeRefWrite, activeStateWrite]) {
      expect(applySessionTabs).toContain(write)
    }
    expect(applySessionTabs.indexOf(tabsRefWrite)).toBeLessThan(
      applySessionTabs.indexOf(tabsStateWrite)
    )
    expect(applySessionTabs.indexOf(activeRefWrite)).toBeLessThan(
      applySessionTabs.indexOf(activeStateWrite)
    )
    expect(recoveryContext).toContain('() => new PendingTerminalHandleRecoveryContextCache()')
    expect(recoveryContext).toContain('sessionTabsRef.current,')
    expect(recoveryContext).toContain('activeSessionTabIdRef.current')
    expect(recoveryContext).toContain(
      'const pendingTerminalRecoveryContextKey = getPendingTerminalRecoveryContextKey()'
    )
    expect(source).toContain('hasRecoveryNeed: hasSessionTabsRecoveryNeed')
    expect(source).toContain('getPendingTerminalRecoveryContextKey,')
    expect(source).toContain('onPendingTerminalRecoveryParked: setParkedPendingTerminalContext')
    expect(source).toContain('retryPendingTerminalRecovery()')
  })
})
