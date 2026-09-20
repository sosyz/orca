import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/diff-comment-types'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import {
  isSameMobileDiffCommentVersion,
  markMobileDiffCommentsSent
} from './mobile-diff-comment-edit'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'

type ReadyReview = Extract<ReviewScreenState, { kind: 'ready' }>
type ReviewMetadata = Pick<ReadyReview, 'comments' | 'reviewState'>

type MetadataSaveInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  screenState: ReviewScreenState
  setScreenState: Dispatch<SetStateAction<ReviewScreenState>>
  setActionError: Dispatch<SetStateAction<string | null>>
}

export function useMobileDiffReviewMetadataSave(input: MetadataSaveInput) {
  const { client, connState, worktreeId, screenState, setScreenState, setActionError } = input
  const scope = useMemo(() => ({ client, worktreeId }), [client, worktreeId])
  const currentScopeRef = useRef<{ client: RpcClient | null; worktreeId: string } | null>(null)
  const activeWorktreeRef = useRef(worktreeId)
  const latestReadyRef = useRef<ReadyReview | null>(
    screenState.kind === 'ready' ? screenState : null
  )
  const confirmedMetadataRef = useRef<ReviewMetadata | null>(
    screenState.kind === 'ready'
      ? { comments: screenState.comments, reviewState: screenState.reviewState }
      : null
  )
  const snapshotRevisionRef = useRef(0)
  const revisionRef = useRef(0)
  const pendingWritesRef = useRef(new WeakMap<RpcClient, Map<string, Promise<void>>>())

  useLayoutEffect(() => {
    if (activeWorktreeRef.current !== worktreeId) {
      latestReadyRef.current = null
      confirmedMetadataRef.current = null
      snapshotRevisionRef.current++
    }
    activeWorktreeRef.current = worktreeId
    currentScopeRef.current = scope
    return () => {
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null
      }
    }
  }, [scope, worktreeId])
  useLayoutEffect(() => {
    if (
      screenState.kind !== 'ready' ||
      screenState.comments !== latestReadyRef.current?.comments ||
      screenState.reviewState !== latestReadyRef.current?.reviewState
    ) {
      // External snapshots supersede acknowledgements from writes started before that refresh.
      confirmedMetadataRef.current =
        screenState.kind === 'ready'
          ? { comments: screenState.comments, reviewState: screenState.reviewState }
          : null
      snapshotRevisionRef.current++
    }
    latestReadyRef.current = screenState.kind === 'ready' ? screenState : null
  }, [screenState])

  const persistMetadata = useCallback(
    async (comments: readonly DiffComment[], reviewState: MobileDiffReviewState) => {
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      const response = await client.sendRequest('worktree.set', {
        worktree: `id:${worktreeId}`,
        diffComments: comments,
        mobileDiffReview: reviewState
      })
      if (!response.ok) {
        throw new Error(response.error?.message || 'Failed to save review state')
      }
    },
    [client, connState, worktreeId]
  )

  const saveReviewMutation = useCallback(
    async (update: (state: ReadyReview) => ReviewMetadata | null): Promise<boolean> => {
      if (currentScopeRef.current !== scope) {
        return false
      }
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      const previous = latestReadyRef.current
      if (!previous) {
        return false
      }
      const metadata = update(previous)
      if (!metadata) {
        return true
      }
      const next: ReadyReview = { ...previous, ...metadata }
      latestReadyRef.current = next
      const revision = ++revisionRef.current
      setScreenState((state) =>
        currentScopeRef.current === scope && state.kind === 'ready'
          ? { ...state, ...metadata }
          : state
      )

      const tails = pendingWritesRef.current.get(client) ?? new Map<string, Promise<void>>()
      pendingWritesRef.current.set(client, tails)
      const prior = tails.get(worktreeId)
      const request = (async () => {
        await prior
        if (currentScopeRef.current !== scope) {
          return false
        }
        const snapshotRevision = snapshotRevisionRef.current
        await persistMetadata(metadata.comments, metadata.reviewState)
        if (currentScopeRef.current === scope && snapshotRevisionRef.current === snapshotRevision) {
          confirmedMetadataRef.current = metadata
        }
        return true
      })()
      const tail = request.then(
        () => undefined,
        () => undefined
      )
      tails.set(worktreeId, tail)
      try {
        const saved = await request
        if (saved && currentScopeRef.current === scope && revisionRef.current === revision) {
          triggerSuccess()
        }
        return saved && currentScopeRef.current === scope
      } catch (err) {
        if (currentScopeRef.current === scope && revisionRef.current === revision) {
          const confirmed = confirmedMetadataRef.current
          if (
            confirmed &&
            latestReadyRef.current?.comments === next.comments &&
            latestReadyRef.current.reviewState === next.reviewState
          ) {
            latestReadyRef.current = { ...latestReadyRef.current, ...confirmed }
            setScreenState((state) =>
              state.kind === 'ready' &&
              state.comments === next.comments &&
              state.reviewState === next.reviewState
                ? { ...state, ...confirmed }
                : state
            )
          }
          triggerError()
          setActionError(err instanceof Error ? err.message : 'Failed to save review')
        }
        throw err
      } finally {
        if (tails.get(worktreeId) === tail) {
          tails.delete(worktreeId)
          if (tails.size === 0) {
            pendingWritesRef.current.delete(client)
          }
        }
      }
    },
    [client, connState, persistMetadata, scope, setActionError, setScreenState, worktreeId]
  )

  const saveCommentsAndReviewState = useCallback(
    (comments: DiffComment[], reviewState: MobileDiffReviewState) =>
      saveReviewMutation(() => ({ comments, reviewState })),
    [saveReviewMutation]
  )

  const markSentComments = useCallback(
    (sent: readonly DiffComment[]) =>
      saveReviewMutation((state) => {
        const sentById = new Map(sent.map((comment) => [comment.id, comment]))
        const matchingIds = new Set(
          state.comments
            .filter((comment) => {
              const submitted = sentById.get(comment.id)
              return submitted && isSameMobileDiffCommentVersion(submitted, comment)
            })
            .map((comment) => comment.id)
        )
        return matchingIds.size === 0
          ? null
          : {
              comments: markMobileDiffCommentsSent(state.comments, matchingIds, Date.now()),
              reviewState: state.reviewState
            }
      }),
    [saveReviewMutation]
  )

  return { saveCommentsAndReviewState, markSentComments }
}
