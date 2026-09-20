import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/diff-comment-types'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { addMobileDiffComment, removeMobileDiffComments } from './mobile-diff-comments'
import { updateMobileDiffComment } from './mobile-diff-comment-edit'
import {
  clearMobileDiffReviewFileReviewed,
  completeMobileDiffReviewState,
  markMobileDiffReviewFileReviewed
} from './mobile-diff-review-state'
import type {
  MobileDiffReviewQueueFilter,
  MobileDiffReviewQueueItem
} from './mobile-diff-review-queue'
import type { ComposerState, ReviewScreenState } from './mobile-diff-review-screen-model'
import {
  nextReviewIndexAfterMarkReviewed,
  reviewDescriptorFromItem
} from './mobile-diff-review-screen-model'
import { useMobileDiffReviewMetadataSave } from './use-mobile-diff-review-metadata-save'

type CommentActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  screenState: ReviewScreenState
  currentItem: MobileDiffReviewQueueItem | null
  queue: MobileDiffReviewQueueItem[]
  filteredQueue: MobileDiffReviewQueueItem[]
  filter: MobileDiffReviewQueueFilter
  currentIndex: number
  composer: ComposerState | null
  composerBody: string
  setScreenState: Dispatch<SetStateAction<ReviewScreenState>>
  setCurrentIndex: Dispatch<SetStateAction<number>>
  setComposer: Dispatch<SetStateAction<ComposerState | null>>
  setComposerBody: Dispatch<SetStateAction<string>>
  setActionError: Dispatch<SetStateAction<string | null>>
  setShowCompletion: Dispatch<SetStateAction<boolean>>
}

export function useMobileDiffReviewCommentActions(input: CommentActionsInput) {
  const {
    client,
    connState,
    worktreeId,
    screenState,
    currentItem,
    queue,
    filteredQueue,
    filter,
    currentIndex,
    composer,
    composerBody,
    setScreenState,
    setCurrentIndex,
    setComposer,
    setComposerBody,
    setActionError,
    setShowCompletion
  } = input
  const composerSnapshot = useMemo(
    () => ({ client, worktreeId, composer, composerBody }),
    [client, worktreeId, composer, composerBody]
  )
  const currentComposerRef = useRef<typeof composerSnapshot | null>(null)
  const pendingComposerRef = useRef<typeof composerSnapshot | null>(null)
  useLayoutEffect(() => {
    currentComposerRef.current = composerSnapshot
    return () => {
      if (currentComposerRef.current === composerSnapshot) {
        currentComposerRef.current = null
      }
    }
  }, [composerSnapshot])
  const { saveCommentsAndReviewState, markSentComments } = useMobileDiffReviewMetadataSave({
    client,
    connState,
    worktreeId,
    screenState,
    setScreenState,
    setActionError
  })

  const openComposer = useCallback(
    (lineNumber: number) => {
      currentComposerRef.current = null
      setComposer({ mode: 'create', lineNumber })
      setComposerBody('')
    },
    [setComposer, setComposerBody]
  )

  const openEditComposer = useCallback(
    (comment: DiffComment) => {
      currentComposerRef.current = null
      setComposer({ mode: 'edit', comment })
      setComposerBody(comment.body)
    },
    [setComposer, setComposerBody]
  )

  const closeComposer = useCallback(() => {
    currentComposerRef.current = null
    setComposer(null)
    setComposerBody('')
  }, [setComposer, setComposerBody])

  const saveComposerMetadata = useCallback(
    async (comments: DiffComment[], reviewState: MobileDiffReviewState): Promise<void> => {
      if (!composerSnapshot.composer || currentComposerRef.current !== composerSnapshot) {
        return
      }
      const pending = pendingComposerRef.current
      if (
        pending?.composer === composerSnapshot.composer &&
        pending.client === client &&
        pending.worktreeId === worktreeId
      ) {
        return
      }
      pendingComposerRef.current = composerSnapshot
      try {
        if (
          (await saveCommentsAndReviewState(comments, reviewState)) &&
          currentComposerRef.current === composerSnapshot
        ) {
          closeComposer()
        }
      } finally {
        if (pendingComposerRef.current === composerSnapshot) {
          pendingComposerRef.current = null
        }
      }
    },
    [client, closeComposer, composerSnapshot, saveCommentsAndReviewState, worktreeId]
  )

  const saveComposer = useCallback(async () => {
    if (!composer || !currentItem || screenState.kind !== 'ready') {
      return
    }
    const now = Date.now()
    const result =
      composer.mode === 'edit'
        ? updateMobileDiffComment(screenState.comments, {
            id: composer.comment.id,
            body: composerBody,
            updatedAt: now
          })
        : addMobileDiffComment(screenState.comments, {
            id: `mobile-${now}-${Math.random().toString(36).slice(2)}`,
            worktreeId,
            filePath: currentItem.filePath,
            oldPath: currentItem.oldPath,
            lineNumber: composer.lineNumber,
            body: composerBody,
            createdAt: now,
            scope: currentItem.scope,
            diffIdentity: currentItem.diffIdentity
          })
    if (!result.comment) {
      return
    }
    await saveComposerMetadata(result.comments, screenState.reviewState)
  }, [composer, composerBody, currentItem, saveComposerMetadata, screenState, worktreeId])

  const deleteComment = useCallback(async () => {
    if (!composer || composer.mode !== 'edit' || screenState.kind !== 'ready') {
      return
    }
    const nextComments = removeMobileDiffComments(
      screenState.comments,
      new Set([composer.comment.id])
    )
    await saveComposerMetadata(nextComments, screenState.reviewState)
  }, [composer, saveComposerMetadata, screenState])

  const markReviewed = useCallback(async () => {
    if (!currentItem || screenState.kind !== 'ready') {
      return
    }
    const now = Date.now()
    let nextReviewState = markMobileDiffReviewFileReviewed(
      screenState.reviewState,
      reviewDescriptorFromItem(currentItem),
      now
    )
    if (queue.every((item) => item.key === currentItem.key || item.isReviewed)) {
      nextReviewState = completeMobileDiffReviewState(nextReviewState, now)
    }
    if (!(await saveCommentsAndReviewState(screenState.comments, nextReviewState))) {
      return
    }
    const nextIndex = nextReviewIndexAfterMarkReviewed({
      currentIndex,
      currentItemKey: currentItem.key,
      filter,
      filteredQueue
    })
    if (nextIndex !== null) {
      setCurrentIndex(nextIndex)
    } else {
      setShowCompletion(true)
    }
  }, [
    currentIndex,
    currentItem,
    filter,
    filteredQueue,
    queue,
    saveCommentsAndReviewState,
    screenState,
    setCurrentIndex,
    setShowCompletion
  ])

  const markUnreviewed = useCallback(async () => {
    if (!currentItem || screenState.kind !== 'ready') {
      return
    }
    const now = Date.now()
    const nextReviewState = clearMobileDiffReviewFileReviewed(
      screenState.reviewState,
      currentItem.key,
      now
    )
    await saveCommentsAndReviewState(screenState.comments, {
      ...nextReviewState,
      completedAt: undefined
    })
  }, [currentItem, saveCommentsAndReviewState, screenState])

  return {
    closeComposer,
    deleteComment,
    markReviewed,
    markSentComments,
    markUnreviewed,
    openComposer,
    openEditComposer,
    saveCommentsAndReviewState,
    saveComposer
  }
}
