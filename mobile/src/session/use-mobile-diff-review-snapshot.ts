import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { loadMobileDiffReviewSnapshot } from './mobile-diff-review-loaders'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'

const LOADING: ReviewScreenState = { kind: 'loading' }

export function useMobileDiffReviewSnapshot(input: {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  setActionError: Dispatch<SetStateAction<string | null>>
}) {
  const { client, connState, hostId, worktreeId, setActionError } = input
  const source = useMemo(() => ({ client, hostId, worktreeId }), [client, hostId, worktreeId])
  const owner = useMemo(() => ({ source, connState }), [source, connState])
  const committedOwner = useRef<typeof owner | null>(null)
  const generationRef = useRef(0)
  const [snapshot, setSnapshot] = useState<{
    source: typeof source
    value: ReviewScreenState
  } | null>(null)
  const screenState = snapshot?.source === source ? snapshot.value : LOADING

  useLayoutEffect(() => {
    committedOwner.current = owner
    return () => {
      if (committedOwner.current === owner) {
        committedOwner.current = null
      }
    }
  }, [owner])

  const setScreenState: Dispatch<SetStateAction<ReviewScreenState>> = useCallback(
    (update) => {
      setSnapshot((previous) => {
        if (committedOwner.current?.source !== source) {
          return previous
        }
        const value = previous?.source === source ? previous.value : LOADING
        return { source, value: typeof update === 'function' ? update(value) : update }
      })
    },
    [source]
  )

  const loadReviewData = useCallback(async () => {
    if (committedOwner.current !== owner) {
      return
    }
    const generation = ++generationRef.current
    const isCurrent = () => committedOwner.current === owner && generationRef.current === generation
    if (!worktreeId) {
      setScreenState({ kind: 'error', message: 'Missing worktree' })
      return
    }
    // Keep a loaded review through a same-source connection blip.
    const keepReady = (fallback: ReviewScreenState) => (previous: ReviewScreenState) =>
      previous.kind === 'ready' ? previous : fallback
    if (!client || connState !== 'connected') {
      setScreenState(keepReady({ kind: 'error', message: 'Waiting for desktop...' }))
      return
    }
    setScreenState(keepReady(LOADING))
    try {
      const nextState = await loadMobileDiffReviewSnapshot(client, worktreeId)
      if (isCurrent()) {
        setScreenState(nextState)
        setActionError(nextState.kind === 'ready' ? (nextState.branchError ?? null) : null)
      }
    } catch (err) {
      if (isCurrent()) {
        setScreenState(
          keepReady({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Unable to load review'
          })
        )
      }
    }
  }, [client, connState, owner, setActionError, setScreenState, worktreeId])

  useEffect(() => {
    void loadReviewData()
  }, [loadReviewData])
  return { source, screenState, setScreenState, loadReviewData }
}
