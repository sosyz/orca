import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { useHostClient } from '../transport/client-context'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import { getWorktreeLabel } from '../session/worktree-label'
import { readMobileRuntimeTerminalWindowsShell } from '../session/ai-vault-resume-launch'
import { useMobileAgentHistoryResume } from './use-mobile-agent-history-resume'
import type { AiVaultScope, AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { Worktree } from '../worktree/workspace-list-types'
import { useMobileAgentHistoryState } from './use-mobile-agent-history-state'
import { buildMobileAgentHistorySections } from './agent-history-sections'
import { shouldShowMobileCurrentWorktreeBadge } from './agent-history-current-worktree-badge'
import { MobileAgentSessionHistoryList } from './MobileAgentSessionHistoryList'
import { buildMobileAgentHistoryResumeActionState } from './agent-history-session-card'
import { styles } from './agent-history-styles'
import { useNow } from '../hooks/use-now'

export type MobileAgentSessionHistoryPanelProps = {
  hostId: string
  worktreeId: string
  name?: string
}

const SCOPE_TABS: { scope: AiVaultScope; label: string }[] = [
  { scope: 'workspace', label: 'Workspace' },
  { scope: 'project', label: 'Project' },
  { scope: 'all', label: 'All' }
]

type WorktreeSource = { client: RpcClient | null; hostId: string }
type WorktreeSnapshot = {
  source: WorktreeSource
  worktrees: Worktree[]
  loaded: boolean
}

export function MobileAgentSessionHistoryPanel({
  hostId,
  worktreeId,
  name = ''
}: MobileAgentSessionHistoryPanelProps) {
  const router = useRouter()
  const { client, state: connState } = useHostClient(hostId)
  const worktreeSource = useMemo(() => ({ client, hostId }), [client, hostId])
  const committedWorktreeOwner = useRef<{
    source: WorktreeSource
    connection: typeof connState
  } | null>(null)
  const [worktreeSnapshot, setWorktreeSnapshot] = useState<WorktreeSnapshot | null>(null)
  const worktrees =
    worktreeSnapshot?.source === worktreeSource ? worktreeSnapshot.worktrees : EMPTY_WORKTREES
  const worktreesLoaded = worktreeSnapshot?.source === worktreeSource && worktreeSnapshot.loaded
  const [query, setQuery] = useState('')
  const now = useNow(30_000)
  const worktreeLabel = getWorktreeLabel(name, worktreeId)

  useLayoutEffect(() => {
    const owner = { source: worktreeSource, connection: connState }
    committedWorktreeOwner.current = owner
    return () => {
      if (committedWorktreeOwner.current === owner) {
        committedWorktreeOwner.current = null
      }
    }
  }, [worktreeSource, connState])

  // Why: the worktree list seeds the host-local scopePaths derivation and the
  // active-worktree path for the "current worktree" badge.
  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    const owner = committedWorktreeOwner.current
    if (!owner || owner.source !== worktreeSource) {
      return
    }
    let cancelled = false
    void (async () => {
      let nextWorktrees: Worktree[] | null = null
      try {
        const worktreeResponse = await client.sendRequest('worktree.ps', { limit: 10000 })
        if (worktreeResponse.ok) {
          const result = (worktreeResponse as RpcSuccess).result as { worktrees: Worktree[] }
          nextWorktrees = result.worktrees
        }
      } catch {
        // Why: worktree list is best-effort context; the session scan still runs
        // (without it, scoped tabs can't narrow and fall back to the full list).
      } finally {
        // Why: mark loaded even on failure so a scoped tab proceeds with an
        // unscoped fetch instead of holding a spinner forever.
        if (!cancelled && committedWorktreeOwner.current === owner) {
          setWorktreeSnapshot((previous) => ({
            source: worktreeSource,
            worktrees:
              nextWorktrees ??
              (previous?.source === worktreeSource ? previous.worktrees : EMPTY_WORKTREES),
            loaded: true
          }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, connState, worktreeSource])

  const {
    scope,
    screenState,
    refreshing,
    hostStatusResult,
    activeWorktreePath,
    scopeFilterPaths,
    onSelectScope,
    onRefresh,
    retry
  } = useMobileAgentHistoryState({ hostId, worktreeId, worktrees, worktreesLoaded })

  const sessions = screenState.kind === 'ready' ? screenState.sessions : EMPTY_SESSIONS
  const issues = screenState.kind === 'ready' ? screenState.issues : EMPTY_ISSUES
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  )
  const sections = useMemo(
    () =>
      buildMobileAgentHistorySections(sessions, {
        query,
        scope,
        scopeFilterPaths,
        activeWorktreePath,
        now
      }),
    [sessions, query, scope, scopeFilterPaths, activeWorktreePath, now]
  )

  const hostPlatform = useMemo(
    () => readMobileRuntimeHostPlatform(hostStatusResult),
    [hostStatusResult]
  )
  const hostTerminalWindowsShell = useMemo(
    () => readMobileRuntimeTerminalWindowsShell(hostStatusResult),
    [hostStatusResult]
  )

  const { onResumeSession, resumingSessionId, resumeMessage } = useMobileAgentHistoryResume({
    client,
    hostId,
    worktreeId,
    connected: connState === 'connected',
    worktrees,
    hostPlatform,
    hostTerminalWindowsShell,
    navigate: (targetHostId, targetWorktreeId) =>
      router.push(
        `/h/${encodeURIComponent(targetHostId)}/session/${encodeURIComponent(targetWorktreeId)}` as Parameters<
          typeof router.push
        >[0]
      )
  })
  const resumeActionStateBySessionId = useMemo(
    () => buildMobileAgentHistoryResumeActionState(sessions, resumingSessionId),
    [resumingSessionId, sessions]
  )

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.header} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              Agent Session History
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {worktreeLabel}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
            onPress={() => void onRefresh()}
            hitSlop={8}
            accessibilityLabel="Refresh agent sessions"
          >
            <RefreshCw size={18} color={colors.textSecondary} strokeWidth={2.1} />
          </Pressable>
        </View>
      </SafeAreaView>

      {screenState.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : screenState.kind === 'unsupported' ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>Agent Session History Unavailable</Text>
          <Text style={styles.stateText}>
            Update Orca on this host to browse agent session history.
          </Text>
        </View>
      ) : screenState.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>Unable to Load</Text>
          <Text style={styles.stateText}>{screenState.message}</Text>
          <Pressable style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.scopeTabs}>
            {SCOPE_TABS.map((tab) => {
              const active = scope === tab.scope
              return (
                <Pressable
                  key={tab.scope}
                  style={[styles.scopeTab, active && styles.scopeTabActive]}
                  onPress={() => onSelectScope(tab.scope)}
                >
                  <Text style={[styles.scopeTabText, active && styles.scopeTabTextActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search sessions, repo:, path:"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {issues.length > 0 ? (
            <View style={styles.noticeBanner}>
              <Text style={styles.noticeText}>
                {issues.length} {issues.length === 1 ? 'transcript' : 'transcripts'} skipped
              </Text>
            </View>
          ) : null}
          {resumeMessage ? (
            <View style={styles.resumeBanner}>
              <Text style={styles.resumeBannerText}>{resumeMessage}</Text>
            </View>
          ) : null}
          {sections.length === 0 ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>No agent sessions</Text>
              <Text style={styles.stateText}>
                {query ? 'No sessions match your search.' : 'No past agent sessions in this scope.'}
              </Text>
            </View>
          ) : (
            <MobileAgentSessionHistoryList
              sections={sections}
              sessionsById={sessionsById}
              refreshing={refreshing}
              showCurrentWorktreeBadges={shouldShowMobileCurrentWorktreeBadge(scope)}
              resumeActionStateBySessionId={resumeActionStateBySessionId}
              onResume={onResumeSession}
              onRefresh={() => void onRefresh()}
            />
          )}
        </>
      )}
    </View>
  )
}

const EMPTY_SESSIONS: AiVaultSession[] = []
const EMPTY_ISSUES: { agent: AiVaultSession['agent']; path: string; message: string }[] = []
const EMPTY_WORKTREES: Worktree[] = []
