import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from 'react'
import { useRouter } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { triggerError, triggerSelection } from '../platform/haptics'
import {
  canOpenMobileGitStatusEntry,
  isMobileGitUnavailable,
  type MobileGitStatusEntry
} from './mobile-git-status'
import { buildMobileReviewFileRoute } from './mobile-review-route'
import * as rendererFallback from './mobile-source-control-renderer-fallback'
import { revealMobileSourceControlSessionDiff } from './reveal-mobile-source-control-session-diff'
import type { MobileBranchCompareState } from './mobile-source-control-screen-state'
import { useMobileSourceControlBranchDiffOpener } from './use-mobile-source-control-branch-diff-opener'

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
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const openingPathRef = useRef<string | null>(null)
  const owner = useMemo(
    () => ({ client, connState, hostId, worktreeId }),
    [client, connState, hostId, worktreeId]
  )
  const committedOwnerRef = useRef<typeof owner | null>(null)
  const previousOwnerRef = useRef(owner)
  useLayoutEffect(() => {
    if (previousOwnerRef.current !== owner) {
      previousOwnerRef.current = owner
      openingPathRef.current = null
      setOpeningPath(null)
    }
    committedOwnerRef.current = owner
    return () => {
      if (committedOwnerRef.current === owner) {
        committedOwnerRef.current = null
      }
    }
  }, [owner])
  const isCurrentOwner = useCallback(
    () => mountedRef.current && committedOwnerRef.current === owner,
    [mountedRef, owner]
  )
  const { branchDiffPreview, setBranchDiffPreview, openingBranchPath, openBranchDiff } =
    useMobileSourceControlBranchDiffOpener({
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
    })

  const openFile = useCallback(
    async (entry: MobileGitStatusEntry) => {
      // Deletions are openable (pre-delete text/image via git.diff); only block
      // unresolved conflicts, matching canOpenMobileGitStatusEntry / row UI.
      if (!canOpenMobileGitStatusEntry(entry)) {
        return
      }
      if (!isCurrentOwner()) {
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
        if (!isCurrentOwner()) {
          return
        }
        let openedTabMode: 'diff' | 'edit' = 'diff'
        if (!response.ok && rendererFallback.isMobileOpenDiffRendererUnavailable(response.error)) {
          if (openingPathRef.current !== entry.path) {
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
          if (!isCurrentOwner()) {
            return
          }
          openedTabMode = 'edit'
        }
        if (!response.ok) {
          throw new Error(response.error?.message || 'Unable to open diff')
        }
        const revealResult = await revealMobileSourceControlSessionDiff({
          client,
          worktreeId,
          relativePath: entry.path,
          tabMode: openedTabMode,
          staged: entry.area === 'staged',
          onOpenedFileDiff,
          isCurrent: () => isCurrentOwner() && openingPathRef.current === entry.path
        })
        if (!isCurrentOwner()) {
          return
        }
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
        if (!isCurrentOwner()) {
          return
        }
        triggerError()
        setActionError(err instanceof Error ? err.message : 'Unable to open diff')
      } finally {
        if (isCurrentOwner() && openingPathRef.current === entry.path) {
          openingPathRef.current = null
          setOpeningPath(null)
        }
      }
    },
    [
      busyActionRef,
      client,
      connState,
      embedded,
      hostId,
      isCurrentOwner,
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
