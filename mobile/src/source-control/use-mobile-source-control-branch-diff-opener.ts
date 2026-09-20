import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
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
import { buildMobileReviewFileRoute } from './mobile-review-route'
import type {
  GitDiffTextResult,
  MobileBranchCompareState,
  MobileBranchDiffPreviewState
} from './mobile-source-control-screen-state'

type Params = {
  owner: object
  isCurrentOwner: () => boolean
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  name: string
  origin: string
  router: ReturnType<typeof useRouter>
  branchCompareState: MobileBranchCompareState
  mountedRef: MutableRefObject<boolean>
  busyActionRef: MutableRefObject<string | null>
  openingPathRef: MutableRefObject<string | null>
  setActionError: (message: string | null) => void
}

export function useMobileSourceControlBranchDiffOpener({
  owner,
  isCurrentOwner,
  client,
  connState,
  hostId,
  worktreeId,
  name,
  origin,
  router,
  branchCompareState,
  mountedRef,
  busyActionRef,
  openingPathRef,
  setActionError
}: Params) {
  const [branchDiffPreview, setBranchDiffPreview] = useState<MobileBranchDiffPreviewState | null>(
    null
  )
  const [openingBranchPath, setOpeningBranchPath] = useState<string | null>(null)
  const openingBranchPathRef = useRef<string | null>(null)
  const previousOwnerRef = useRef(owner)
  useLayoutEffect(() => {
    if (previousOwnerRef.current !== owner) {
      previousOwnerRef.current = owner
      openingBranchPathRef.current = null
      setOpeningBranchPath(null)
      setBranchDiffPreview(null)
    }
  }, [owner])

  const openBranchDiff = useCallback(
    async (entry: MobileGitBranchChangeEntry) => {
      if (!isCurrentOwner()) {
        return
      }
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
        if (!isCurrentOwner()) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error?.message || 'Unable to load committed diff')
        }
        const result = (response as RpcSuccess).result as GitDiffTextResult | { kind: 'binary' }
        if (result.kind !== 'text') {
          throw new Error('Binary branch diff preview unavailable on mobile')
        }
        const diff = buildMobileDiffLines(result.originalContent, result.modifiedContent)
        const syntaxLanguage = resolveMobileSyntaxLanguage(entry.path)
        setBranchDiffPreview({
          kind: 'ready',
          entry,
          summary,
          lines: highlightMobileDiffLines(diff.lines, syntaxLanguage),
          truncated: diff.truncated
        })
        triggerSelection()
      } catch (err) {
        if (!isCurrentOwner()) {
          return
        }
        triggerError()
        setBranchDiffPreview({
          kind: 'error',
          entry,
          message: err instanceof Error ? err.message : 'Unable to load committed diff'
        })
      } finally {
        if (isCurrentOwner() && openingBranchPathRef.current === entry.path) {
          openingBranchPathRef.current = null
          setOpeningBranchPath(null)
        }
      }
    },
    [
      branchCompareState,
      busyActionRef,
      client,
      connState,
      hostId,
      isCurrentOwner,
      mountedRef,
      name,
      origin,
      router,
      setActionError,
      worktreeId
    ]
  )

  return { branchDiffPreview, setBranchDiffPreview, openingBranchPath, openBranchDiff }
}
