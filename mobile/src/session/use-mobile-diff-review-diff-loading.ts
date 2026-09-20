import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { loadMobileDiffReviewDiff } from './mobile-diff-review-loaders'
import type { MobileDiffReviewQueueItem } from './mobile-diff-review-queue'
import type { ReviewDiffState, ReviewScreenState } from './mobile-diff-review-screen-model'

type DiffLoadingInput = {
  client: RpcClient | null
  connState: ConnectionState
  hostId?: string
  worktreeId: string
  currentItem: MobileDiffReviewQueueItem | null
  screenState: ReviewScreenState
  setActiveHunkIndex: (index: number | null) => void
}

// Owns the diff body for the reviewed item. Split out of the review controller so the loaded diff
// can survive a transport blip: a drop re-runs this effect, and (F10) a diff already on screen for
// the same item stays there instead of being replaced by "Waiting for desktop..." or a spinner.
export function useMobileDiffReviewDiffLoading(input: DiffLoadingInput): ReviewDiffState {
  const { client, connState, hostId, worktreeId, currentItem, screenState, setActiveHunkIndex } =
    input
  const source = useMemo(() => ({ client, hostId, worktreeId }), [client, hostId, worktreeId])
  const [snapshot, setSnapshot] = useState<{
    source: typeof source
    value: ReviewDiffState
  } | null>(null)
  const hunkResetKeyRef = useRef<{ source: typeof source; itemKey: string | null } | null>(null)
  // Metadata edits retain status; a fresh status snapshot must reload even when
  // line counts leave diffIdentity unchanged.
  const screenReady = screenState.kind === 'ready'
  const statusSnapshot = screenState.kind === 'ready' ? screenState.status : null
  const branchCompare = screenState.kind === 'ready' ? screenState.branchCompare : null
  const itemKey = currentItem?.key ?? null
  const itemScope = currentItem?.scope ?? null
  const itemFilePath = currentItem?.filePath ?? null
  const itemOldPath = currentItem?.oldPath
  const itemStatus = currentItem?.status ?? null
  const diffItem = useMemo(
    () =>
      itemKey !== null && itemScope !== null && itemFilePath !== null && itemStatus !== null
        ? {
            key: itemKey,
            scope: itemScope,
            filePath: itemFilePath,
            oldPath: itemOldPath,
            status: itemStatus
          }
        : null,
    [itemKey, itemScope, itemFilePath, itemOldPath, itemStatus]
  )

  useEffect(() => {
    const setDiffState = (
      update: ReviewDiffState | ((previous: ReviewDiffState) => ReviewDiffState)
    ) => {
      setSnapshot((previous) => {
        const value = previous?.source === source ? previous.value : ({ kind: 'idle' } as const)
        return { source, value: typeof update === 'function' ? update(value) : update }
      })
    }
    // Why (F10): a connection blip re-runs this effect; the reader's hunk position must
    // survive it and reset only when the reviewed item actually changes.
    const hunkKey = diffItem?.key ?? null
    if (hunkResetKeyRef.current?.source !== source || hunkResetKeyRef.current.itemKey !== hunkKey) {
      hunkResetKeyRef.current = { source, itemKey: hunkKey }
      setActiveHunkIndex(null)
    }
    if (!diffItem || !screenReady) {
      setDiffState({ kind: 'idle' })
      return
    }
    const itemKey = diffItem.key
    const keepLoadedDiff = (fallback: ReviewDiffState) => (prev: ReviewDiffState) =>
      prev.kind === 'ready' && prev.itemKey === itemKey ? prev : fallback
    if (!client || connState !== 'connected') {
      setDiffState(keepLoadedDiff({ kind: 'error', itemKey, message: 'Waiting for desktop...' }))
      return
    }
    let stale = false
    setDiffState(keepLoadedDiff({ kind: 'loading', itemKey }))
    void loadMobileDiffReviewDiff({
      client,
      worktreeId,
      item: diffItem,
      branchCompare
    })
      .then((nextState) => {
        if (!stale) {
          setDiffState(nextState)
        }
      })
      .catch((err: unknown) => {
        if (!stale) {
          // Why (F10): a rejected reconnect refetch must not erase the diff on screen.
          setDiffState(
            keepLoadedDiff({
              kind: 'error',
              itemKey,
              message: err instanceof Error ? err.message : 'Unable to load diff'
            })
          )
        }
      })
    return () => {
      stale = true
    }
  }, [
    client,
    connState,
    diffItem,
    screenReady,
    statusSnapshot,
    branchCompare,
    setActiveHunkIndex,
    source,
    worktreeId
  ])

  return snapshot?.source === source && screenReady ? snapshot.value : { kind: 'idle' }
}
