import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { ConnectionState, RpcResponse, RpcSuccess } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { useForceReconnect } from '../transport/client-context'
import {
  fetchMobileGitHistory,
  mapMobileCommitRows,
  type MobileCommitRow
} from './mobile-git-history'
import { resolveMobileHistoryScreenView } from './mobile-history-screen-state'
import type { GitBranchChangeEntry } from '../../../src/shared/git-diff-compare-types'

type CommitFilesState =
  | { kind: 'loading'; entries?: GitBranchChangeEntry[] }
  | { kind: 'loaded'; entries: GitBranchChangeEntry[] }
  | { kind: 'error'; message: string; entries?: GitBranchChangeEntry[] }

function commitCompareErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load file changes'
}

function commitCompareEntries(response: RpcResponse): GitBranchChangeEntry[] {
  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to load file changes')
  }
  return ((response as RpcSuccess).result as { entries: GitBranchChangeEntry[] }).entries
}

type Props = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  // Needed so Retry can revive a parked reconnect loop (STA-1511 / #5049).
  hostId: string
  bottomInset: number
  // Bumped by the hub header refresh so History reloads without remounting.
  refreshNonce?: number
}

// Headerless commit-history list. Extracted from the /history route so the hub's
// History segment and the standalone route render the same body over one code path.
// Memoized: it stays mounted (hidden) while the Changes segment is active, and must
// not re-reconcile its FlatList on every commit-message keystroke re-render.
export const MobileGitHistoryList = memo(function MobileGitHistoryList({
  client,
  connState,
  worktreeId,
  hostId,
  bottomInset,
  refreshNonce = 0
}: Props) {
  const forceReconnect = useForceReconnect()
  const [rows, setRows] = useState<MobileCommitRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [filesReloadNonce, setFilesReloadNonce] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filesById, setFilesById] = useState<Record<string, CommitFilesState>>({})
  const scopeKey = `${hostId}\0${worktreeId}`
  const [source, setSource] = useState({ client, scopeKey })
  const liveSourceRef = useRef<typeof source | null>(null)

  // Reset before children render so old expanded commits cannot be requested from a new client.
  if (source.client !== client || source.scopeKey !== scopeKey) {
    setSource({ client, scopeKey })
    setRows(null)
    setError(null)
    setExpanded(null)
    setFilesById({})
  }
  useLayoutEffect(() => {
    liveSourceRef.current = source
    return () => {
      liveSourceRef.current = null
    }
  }, [source])

  useEffect(() => {
    let active = true
    if (!client || connState !== 'connected' || !worktreeId) {
      // Why: leave already-loaded rows (and expand state) alone across a drop —
      // resolveMobileHistoryScreenView keeps them visible (STA-1511).
      return
    }
    // Why (F10): clear only the error (it wins render precedence, so a stale one would outlive a
    // successful retry) — the loaded rows stay up until fresh ones land instead of flashing empty.
    setError(null)
    void (async () => {
      try {
        const result = await fetchMobileGitHistory(client, worktreeId)
        if (active && source === liveSourceRef.current) {
          setRows(mapMobileCommitRows(result, Date.now()))
        }
      } catch (err) {
        if (active && source === liveSourceRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load history')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [client, connState, reloadNonce, refreshNonce, source, worktreeId])

  const retry = useCallback(() => {
    if (source !== liveSourceRef.current) {
      return
    }
    setError(null)
    // Why: retrying the fetch is useless while the transport's reconnect loop
    // is parked at its backoff cap — revive the connection instead (mirrors
    // MobileSourceControlPanel / issue #5049). The load effect re-runs via
    // connState once the fresh client connects.
    if (connState !== 'connected' && hostId) {
      void forceReconnect(hostId)
      return
    }
    setReloadNonce((n) => n + 1)
  }, [connState, forceReconnect, hostId, source])

  const toggleCommit = useCallback(
    (row: MobileCommitRow) => {
      if (source === liveSourceRef.current) {
        setExpanded((current) => (current === row.id ? null : row.id))
      }
    },
    [source]
  )

  const retryCommitFiles = useCallback(
    (commitId: string) => {
      if (source !== liveSourceRef.current) {
        return
      }
      setFilesById((prev) => ({
        ...prev,
        [commitId]: { kind: 'loading', entries: prev[commitId]?.entries }
      }))
      if (connState !== 'connected' && hostId) {
        void forceReconnect(hostId)
        return
      }
      setFilesReloadNonce((n) => n + 1)
    },
    [connState, forceReconnect, hostId, source]
  )

  // Why (F10): the expanded commit's files load here, not in the tap handler, so a row expanded
  // during an outage refetches on reconnect instead of caching the outage's answer forever.
  useEffect(() => {
    if (!expanded || !client || connState !== 'connected') {
      return
    }
    const commitId = expanded
    let stale = false
    setFilesById((prev) => (prev[commitId] ? prev : { ...prev, [commitId]: { kind: 'loading' } }))
    void client
      .sendRequest('git.commitCompare', { worktree: `id:${worktreeId}`, commitId })
      .then((response) => {
        const entries = commitCompareEntries(response)
        if (!stale && source === liveSourceRef.current) {
          setFilesById((prev) => ({ ...prev, [commitId]: { kind: 'loaded', entries } }))
        }
      })
      .catch((err) => {
        if (!stale && source === liveSourceRef.current) {
          setFilesById((prev) => ({
            ...prev,
            [commitId]: {
              kind: 'error',
              message: commitCompareErrorMessage(err),
              entries: prev[commitId]?.entries
            }
          }))
        }
      })
    return () => {
      stale = true
    }
  }, [client, connState, expanded, filesReloadNonce, source, worktreeId])

  const connected = client !== null && connState === 'connected'

  const renderCommit = useCallback(
    ({ item }: { item: MobileCommitRow }) => {
      const files = filesById[item.id]
      const entries = files?.entries ?? []
      const isOpen = expanded === item.id
      return (
        <View style={styles.commit}>
          <Pressable
            style={({ pressed }) => [styles.commitHeader, pressed && styles.commitHeaderPressed]}
            onPress={() => toggleCommit(item)}
          >
            {isOpen ? (
              <ChevronDown size={14} color={colors.textMuted} />
            ) : (
              <ChevronRight size={14} color={colors.textMuted} />
            )}
            <View style={styles.commitMain}>
              <Text style={styles.commitSubject} numberOfLines={1}>
                {item.subject}
              </Text>
              <Text style={styles.commitMeta} numberOfLines={1}>
                {item.shortId} · {item.author} · {item.relativeTime}
              </Text>
            </View>
          </Pressable>
          {isOpen ? (
            <View style={styles.files}>
              {files === undefined || (files.kind === 'loading' && entries.length === 0) ? (
                // No request can complete while disconnected, so say so instead of spinning forever.
                connected ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text style={styles.empty}>Waiting for desktop...</Text>
                )
              ) : null}
              {files?.kind === 'loading' && entries.length > 0 ? (
                connected ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text style={styles.empty}>Waiting for desktop...</Text>
                )
              ) : null}
              {files?.kind === 'error' ? (
                <View style={styles.fileErrorBlock}>
                  <Text style={styles.fileError}>{files.message}</Text>
                  <Pressable
                    style={styles.fileRetryButton}
                    onPress={() => retryCommitFiles(item.id)}
                    accessibilityLabel="Retry file changes"
                  >
                    <Text style={styles.fileRetryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}
              {files?.kind === 'loaded' && entries.length === 0 ? (
                <Text style={styles.empty}>No file changes</Text>
              ) : null}
              {entries.length > 0
                ? entries.map((file) => (
                    <View key={file.path} style={styles.fileRow}>
                      <Text style={styles.filePath} numberOfLines={1}>
                        {file.path}
                      </Text>
                      <Text style={styles.fileStat}>
                        {file.added ? <Text style={styles.add}>+{file.added} </Text> : null}
                        {file.removed ? <Text style={styles.del}>-{file.removed}</Text> : null}
                      </Text>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </View>
      )
    },
    [connected, expanded, filesById, retryCommitFiles, toggleCommit]
  )

  const view = resolveMobileHistoryScreenView({ connected, rows, error })

  if (view.kind === 'error' || view.kind === 'waiting') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>
          {view.kind === 'waiting' ? 'Waiting for desktop...' : view.message}
        </Text>
        <Pressable style={styles.retryButton} onPress={retry} accessibilityLabel="Retry">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    )
  }
  if (view.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }
  if (view.kind === 'empty') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>No commits.</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={view.rows}
      renderItem={renderCommit}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{ paddingBottom: spacing.lg + bottomInset }}
    />
  )
})

const styles = StyleSheet.create({
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  stateText: { color: colors.textMuted, fontSize: typography.bodySize },
  retryButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  retryText: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  commit: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  commitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2
  },
  commitHeaderPressed: { backgroundColor: colors.bgRaised },
  commitMain: { flex: 1, minWidth: 0 },
  commitSubject: { color: colors.textPrimary, fontSize: typography.bodySize },
  commitMeta: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    marginTop: 2
  },
  files: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  filePath: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  fileStat: { fontSize: typography.metaSize, fontFamily: typography.monoFamily },
  add: { color: colors.gitDecorationAdded },
  del: { color: colors.gitDecorationDeleted },
  empty: { color: colors.textMuted, fontSize: typography.metaSize },
  fileErrorBlock: { gap: spacing.xs },
  fileError: { color: colors.statusRed, fontSize: typography.metaSize },
  fileRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  fileRetryText: { color: colors.textPrimary, fontSize: typography.metaSize, fontWeight: '600' }
})
