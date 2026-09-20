import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { githubRepoIdentityKey } from '../../../src/shared/github/repository-identity-key'
import type { PRComment } from '../../../src/shared/github/comment-types'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import type { GitHubPrRepoSlug } from './github-pr-rpc'
import {
  fetchAddIssueComment,
  fetchAddPRReviewCommentReply,
  fetchDeleteIssueComment,
  fetchResolveReviewThread,
  fetchUpdateIssueComment,
  type GitHubPrMutationOutcome
} from './github-pr-mutations'
import { triggerError, triggerSuccess } from '../platform/haptics'
import {
  buildAddRootCommentParams,
  buildDeleteCommentParams,
  buildEditCommentParams,
  buildReplyParams,
  buildResolveParams
} from './pr-comment-actions'

export type PrCommentMutations = {
  reply: (args: {
    prNumber: number
    commentId: number
    body: string
    threadId?: string
    path?: string
    line?: number
    prRepo?: GitHubPrRepoSlug | null
  }) => Promise<GitHubPrMutationOutcome>
  resolveThread: (args: {
    threadId: string
    resolve: boolean
    prRepo?: GitHubPrRepoSlug | null
  }) => Promise<GitHubPrMutationOutcome>
  addRootComment: (args: {
    prNumber: number
    body: string
    prRepo?: GitHubPrRepoSlug | null
  }) => Promise<GitHubPrMutationOutcome>
  editComment: (args: {
    owner: string
    repo: string
    host?: string
    commentId: number
    body: string
  }) => Promise<GitHubPrMutationOutcome>
  deleteComment: (args: {
    owner: string
    repo: string
    host?: string
    commentId: number
  }) => Promise<GitHubPrMutationOutcome>
}

export type PrCommentActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  prNumber: number
  prRepo?: GitHubPrRepoSlug | null
  // Re-fetches the authoritative comment timeline after a successful mutation so
  // the new reply/comment and toggled resolve state appear (desktop merges the
  // returned comment; mobile keeps it simple with a full refetch).
  refetch: () => void | Promise<void>
  // Test seam: inject fake mutations; defaults to the real github.* wrappers.
  mutations?: PrCommentMutations
}

function realMutations(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): PrCommentMutations {
  return {
    reply: (args) => fetchAddPRReviewCommentReply(client, worktreeId, args),
    resolveThread: (args) => fetchResolveReviewThread(client, worktreeId, args),
    addRootComment: (args) => fetchAddIssueComment(client, worktreeId, args),
    // Edit/delete are slug-addressed (owner/repo/commentId), so they take no worktreeId.
    editComment: (args) => fetchUpdateIssueComment(client, args),
    deleteComment: (args) => fetchDeleteIssueComment(client, args)
  }
}

// Stable busy keys: 'root' for the root composer; otherwise per-comment so one
// reply/resolve in flight doesn't disable every other card.
function replyKey(commentId: number): string {
  return `reply:${commentId}`
}
function resolveKey(threadId: string): string {
  return `resolve:${threadId}`
}
function editKey(commentId: number): string {
  return `edit:${commentId}`
}
function deleteKey(commentId: number): string {
  return `delete:${commentId}`
}
const ROOT_KEY = 'root'

type PrCommentSource = {
  client: RpcClient | null
  worktreeId: string
  prNumber: number
  repoKey: string
}

function samePrCommentTarget(a: PrCommentSource, b: PrCommentSource): boolean {
  return (
    a.client === b.client &&
    a.worktreeId === b.worktreeId &&
    a.prNumber === b.prNumber &&
    a.repoKey === b.repoKey
  )
}

// React adapter for the three interactive comment actions. Tracks per-action
// in-flight keys + a single error message, fires haptics, and refetches on success.
export function useMobilePrCommentActions(input: PrCommentActionsInput) {
  const { client, connState, worktreeId, prNumber, prRepo, refetch } = input
  const repoKey = prRepo ? githubRepoIdentityKey(prRepo) : ''
  const source = useMemo(
    () => ({ client, connState, worktreeId, prNumber, repoKey }),
    [client, connState, worktreeId, prNumber, repoKey]
  )
  const committedSource = useRef<typeof source | null>(null)
  const attempts = useRef(new Set<{ source: typeof source; key: string }>())
  const [busyRevision, refreshBusy] = useReducer((revision: number) => revision + 1, 0)
  const [failure, setFailure] = useState<{ source: typeof source; message: string } | null>(null)
  const isCurrentSource = useCallback(() => committedSource.current === source, [source])

  useLayoutEffect(() => {
    committedSource.current = source
    return () => {
      if (committedSource.current === source) {
        committedSource.current = null
      }
    }
  }, [source])

  const mutations = useMemo(
    () => input.mutations ?? (client ? realMutations(client, worktreeId) : null),
    [input.mutations, client, worktreeId]
  )
  const ready =
    prNumber > 0 &&
    mutations !== null &&
    (input.mutations !== undefined || connState === 'connected')
  const busyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const attempt of attempts.current) {
      if (
        samePrCommentTarget(attempt.source, source) &&
        attempt.source.connState === source.connState
      ) {
        keys.add(attempt.key)
      }
    }
    return keys
  }, [source, busyRevision])

  const run = useCallback(
    async (key: string, mutate: () => Promise<GitHubPrMutationOutcome>): Promise<boolean> => {
      if (!isCurrentSource() || !ready) {
        return false
      }
      for (const attempt of attempts.current) {
        if (attempt.key === key && samePrCommentTarget(attempt.source, source)) {
          return false
        }
      }
      const attempt = { source, key }
      attempts.current.add(attempt)
      refreshBusy()
      setFailure(null)
      try {
        const outcome = await mutate()
        if (!isCurrentSource()) {
          return false
        }
        if (outcome.ok) {
          await refetch()
          if (!isCurrentSource()) {
            return false
          }
          triggerSuccess()
          return true
        }
        triggerError()
        setFailure({ source, message: outcome.error })
        return false
      } catch (err) {
        // Why: if a mutation (or the refetch) throws, still honor the boolean
        // contract — error haptic + message, return false — rather than rejecting.
        if (isCurrentSource()) {
          triggerError()
          setFailure({
            source,
            message: err instanceof Error ? err.message : 'Comment action failed'
          })
        }
        return false
      } finally {
        attempts.current.delete(attempt)
        if (committedSource.current) {
          refreshBusy()
        }
      }
    },
    [ready, isCurrentSource, source, refetch]
  )

  const reply = useCallback(
    (comment: PRComment, body: string) => {
      if (!mutations) {
        return Promise.resolve(false)
      }
      const params = buildReplyParams(prNumber, comment, body)
      return run(replyKey(comment.id), () => mutations.reply({ ...params, prRepo }))
    },
    [mutations, prNumber, prRepo, run]
  )

  const toggleResolve = useCallback(
    (comment: PRComment) => {
      const params = buildResolveParams(comment)
      if (!mutations || !params) {
        return Promise.resolve(false)
      }
      return run(resolveKey(params.threadId), () => mutations.resolveThread({ ...params, prRepo }))
    },
    [mutations, prRepo, run]
  )

  const addRootComment = useCallback(
    (body: string) => {
      if (!mutations) {
        return Promise.resolve(false)
      }
      const params = buildAddRootCommentParams(prNumber, body)
      return run(ROOT_KEY, () => mutations.addRootComment({ ...params, prRepo }))
    },
    [mutations, prNumber, prRepo, run]
  )

  const editComment = useCallback(
    (commentId: number, body: string) => {
      // Edit is slug-addressed, so a missing prRepo means we cannot target the comment.
      if (!mutations || !prRepo) {
        return Promise.resolve(false)
      }
      const params = buildEditCommentParams(prRepo, commentId, body)
      return run(editKey(commentId), () => mutations.editComment(params))
    },
    [mutations, prRepo, run]
  )

  const deleteComment = useCallback(
    (commentId: number) => {
      if (!mutations || !prRepo) {
        return Promise.resolve(false)
      }
      const params = buildDeleteCommentParams(prRepo, commentId)
      return run(deleteKey(commentId), () => mutations.deleteComment(params))
    },
    [mutations, prRepo, run]
  )

  return {
    ready,
    error: failure?.source === source ? failure.message : null,
    clearError: useCallback(() => {
      if (isCurrentSource()) {
        setFailure(null)
      }
    }, [isCurrentSource]),
    isReplyBusy: useCallback((commentId: number) => busyKeys.has(replyKey(commentId)), [busyKeys]),
    isResolveBusy: useCallback(
      (threadId: string) => busyKeys.has(resolveKey(threadId)),
      [busyKeys]
    ),
    isEditBusy: useCallback((commentId: number) => busyKeys.has(editKey(commentId)), [busyKeys]),
    isDeleteBusy: useCallback(
      (commentId: number) => busyKeys.has(deleteKey(commentId)),
      [busyKeys]
    ),
    isRootBusy: busyKeys.has(ROOT_KEY),
    reply,
    toggleResolve,
    addRootComment,
    editComment,
    deleteComment
  }
}

export type MobilePrCommentActions = ReturnType<typeof useMobilePrCommentActions>
