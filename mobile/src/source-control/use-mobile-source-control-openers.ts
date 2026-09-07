import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import { useRouter } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcSuccess } from '../transport/types'
import { triggerError, triggerSelection } from '../platform/haptics'
import { buildMobileDiffLines } from '../session/mobile-diff-lines'
import {
  highlightMobileDiffLines,
  resolveMobileSyntaxLanguage
} from '../session/mobile-file-syntax'
import {
  canOpenMobileBranchCompareDiff,
  type MobileGitBranchChangeEntry
} from './mobile-branch-compare'
import {
  canOpenMobileGitStatusEntry,
  isMobileGitUnavailable,
  type MobileGitStatusEntry
} from './mobile-git-status'
import { buildMobileReviewFileRoute } from './mobile-review-route'
import * as rendererFallback from './mobile-source-control-renderer-fallback'
import { revealMobileSourceControlSessionDiff } from './reveal-mobile-source-control-session-diff'
import type {
  GitDiffTextResult,
  MobileBranchCompareState,
  MobileBranchDiffPreviewState
} from './mobile-source-control-screen-state'

type Params = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  name: string
  origin: string
  embedded: boolean
  onRequestClose?: () => void
  // Fired before openDiff so the session snapshots the tap-time active tab,
  // not one the user switched to during the RPC window.
  onFileOpenStart?: () => void
  onOpenedFileDiff?: (relativePath: string) => void
  branchCompareState: MobileBranchCompareState
  mountedRef: MutableRefObject<boolean>
  busyActionRef: MutableRefObject<string | null>
  setActionError: (message: string | null) => void
}

// Owns changed-file open/branch-preview flows and their in-flight row state.
export function useMobileSourceControlOpeners(params: Params) {
  const {
    client,
    connState,
    hostId,
    worktreeId,
    name,
    origin,
    embedded,
    onRequestClose,
    onFileOpenStart,
    onOpenedFileDiff,
    branchCompareState,
    mountedRef,
    busyActionRef,
    setActionError
  } = params
  const router = useRouter()
  const [branchDiffPreview, setBranchDiffPreview] = useState<MobileBranchDiffPreviewState | null>(
    null
  )
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [openingBranchPath, setOpeningBranchPath] = useState<string | null>(null)
  const openingPathRef = useRef<string | null>(null)
  const openingBranchPathRef = useRef<string | null>(null)

  const openFile = useCallback(
    async (entry: MobileGitStatusEntry) => {
      // Deletions are openable (pre-delete text/image via git.diff); only block
      // unresolved conflicts, matching canOpenMobileGitStatusEntry / row UI.
      if (!canOpenMobileGitStatusEntry(entry)) {
        return
      }
      if (openingPathRef.current || busyActionRef.current) {
        return
      }
      if (!client || connState !== 'connected') {
        if (!mountedRef.current) {
          return
        }
        setActionError('Waiting for desktop...')
        return
      }
      openingPathRef.current = entry.path
      setOpeningPath(entry.path)
      try {
        setActionError(null)
        if (origin !== 'session') {
          triggerSelection()
          router.push(
            buildMobileReviewFileRoute({
              hostId,
              worktreeId,
              worktreeName: name,
              filePath: entry.path,
              area: entry.area
            }) as Parameters<typeof router.push>[0]
          )
          return
        }
        // Snapshot now so session focus recovery uses the tap-time tab.
        onFileOpenStart?.()
        let response = await client.sendRequest('files.openDiff', {
          worktree: `id:${worktreeId}`,
          relativePath: entry.path,
          staged: entry.area === 'staged'
        })
        let openedTabMode: 'diff' | 'edit' = 'diff'
        if (!response.ok && rendererFallback.isMobileOpenDiffRendererUnavailable(response.error)) {
          if (!mountedRef.current || openingPathRef.current !== entry.path) {
            return
          }
          triggerSelection()
          rendererFallback.navigateMobileOpenDiffRendererFallback({
            router,
            hostId,
            worktreeId,
            worktreeName: name,
            entry,
            embedded,
            onRequestClose
          })
          return
        }
        if (!response.ok && isMobileGitUnavailable(response.error?.code, response.error?.message)) {
          response = await client.sendRequest('files.open', {
            worktree: `id:${worktreeId}`,
            relativePath: entry.path
          })
          openedTabMode = 'edit'
        }
        if (!response.ok) {
          throw new Error(response.error?.message || 'Unable to open diff')
        }
        if (!mountedRef.current) {
          return
        }
        const revealResult = await revealMobileSourceControlSessionDiff({
          client,
          worktreeId,
          relativePath: entry.path,
          tabMode: openedTabMode,
          staged: entry.area === 'staged',
          onOpenedFileDiff,
          isCurrent: () => mountedRef.current && openingPathRef.current === entry.path
        })
        if (revealResult === 'cancelled') {
          return
        }
        if (revealResult === 'timeout') {
          throw new Error("The file opened, but its tab isn't ready yet. Try again.")
        }
        triggerSelection()
        // Why: route-launched panels pop back to the session; docked panels have
        // nothing to pop, so close the dock instead.
        if (embedded) {
          ;(onRequestClose ?? (() => router.back()))()
        } else {
          router.back()
        }
      } catch (err) {
        if (!mountedRef.current) {
          return
        }
        triggerError()
        setActionError(err instanceof Error ? err.message : 'Unable to open diff')
      } finally {
        if (openingPathRef.current === entry.path) {
          openingPathRef.current = null
          if (mountedRef.current) {
            setOpeningPath(null)
          }
        }
      }
    },
    [
      busyActionRef,
      client,
      connState,
      embedded,
      hostId,
      mountedRef,
      name,
      onFileOpenStart,
      onOpenedFileDiff,
      onRequestClose,
      origin,
      router,
      setActionError,
      worktreeId
    ]
  )

  const openBranchDiff = useCallback(
    async (entry: MobileGitBranchChangeEntry) => {
      if (openingBranchPathRef.current || openingPathRef.current || busyActionRef.current) {
        return
      }
      if (!client || connState !== 'connected') {
        if (!mountedRef.current) {
          return
        }
        setActionError('Waiting for desktop...')
        return
      }
      if (branchCompareState.kind !== 'ready') {
        return
      }
      const summary = branchCompareState.result.summary
      if (!canOpenMobileBranchCompareDiff(summary) || !summary.headOid || !summary.mergeBase) {
        return
      }

      openingBranchPathRef.current = entry.path
      setOpeningBranchPath(entry.path)
      if (origin !== 'session') {
        triggerSelection()
        router.push(
          buildMobileReviewFileRoute({
            hostId,
            worktreeId,
            worktreeName: name,
            filePath: entry.path,
            area: 'branch'
          }) as Parameters<typeof router.push>[0]
        )
        openingBranchPathRef.current = null
        if (mountedRef.current) {
          setOpeningBranchPath(null)
        }
        return
      }
      setBranchDiffPreview({ kind: 'loading', entry })
      try {
        const response = await client.sendRequest('git.branchDiff', {
          worktree: `id:${worktreeId}`,
          filePath: entry.path,
          ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
          compare: {
            baseRef: summary.baseRef,
            ...(summary.baseOid ? { baseOid: summary.baseOid } : {}),
            headOid: summary.headOid,
            mergeBase: summary.mergeBase
          }
        })
        if (!response.ok) {
          throw new Error(response.error?.message || 'Unable to load committed diff')
        }
        const result = (response as RpcSuccess).result as GitDiffTextResult | { kind: 'binary' }
        if (result.kind !== 'text') {
          throw new Error('Binary branch diff preview unavailable on mobile')
        }
        const diff = buildMobileDiffLines(result.originalContent, result.modifiedContent)
        const syntaxLanguage = resolveMobileSyntaxLanguage(entry.path)
        if (!mountedRef.current) {
          return
        }
        setBranchDiffPreview({
          kind: 'ready',
          entry,
          summary,
          lines: highlightMobileDiffLines(diff.lines, syntaxLanguage),
          truncated: diff.truncated
        })
        triggerSelection()
      } catch (err) {
        if (!mountedRef.current) {
          return
        }
        triggerError()
        setBranchDiffPreview({
          kind: 'error',
          entry,
          message: err instanceof Error ? err.message : 'Unable to load committed diff'
        })
      } finally {
        if (openingBranchPathRef.current === entry.path) {
          openingBranchPathRef.current = null
          if (mountedRef.current) {
            setOpeningBranchPath(null)
          }
        }
      }
    },
    [
      branchCompareState,
      busyActionRef,
      client,
      connState,
      hostId,
      mountedRef,
      name,
      origin,
      router,
      setActionError,
      worktreeId
    ]
  )

  return {
    router,
    branchDiffPreview,
    setBranchDiffPreview,
    openingPath,
    openingBranchPath,
    openFile,
    openBranchDiff
  }
}
