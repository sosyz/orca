import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { triggerError, triggerSelection, triggerSuccess } from '../platform/haptics'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  addMobileDiffComment,
  normalizeMobileDiffComments,
  removeMobileDiffComments
} from './mobile-diff-comments'
import { isSameMobileDiffCommentVersion } from './mobile-diff-comment-edit'

type Input = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  enabled: boolean
  showToast: (message: string, duration?: number) => void
}
type Owner = {
  client: RpcClient | null
  worktreeId: string
  active: boolean
  ready: boolean
  loading: boolean
  loadError: string | null
  comments: DiffComment[]
  confirmed: DiffComment[]
  readRevision: number
  pendingWrites: number
}
type CommentWriteQueue = { tail?: Promise<void>; pendingDelivered: Set<DiffComment> }
type CommentWriteQueues = WeakMap<RpcClient, Map<string, CommentWriteQueue>>
function getCommentWriteQueue(queues: CommentWriteQueues, client: RpcClient, worktreeId: string) {
  const targets = queues.get(client) ?? new Map<string, CommentWriteQueue>()
  queues.set(client, targets)
  const queue = targets.get(worktreeId) ?? { pendingDelivered: new Set<DiffComment>() }
  targets.set(worktreeId, queue)
  return { targets, queue }
}

export function useMobileSessionDiffComments({
  client,
  connState,
  worktreeId,
  enabled,
  showToast
}: Input) {
  const owner = useMemo<Owner>(
    () => ({
      client,
      worktreeId,
      active: false,
      ready: false,
      loading: false,
      loadError: null,
      comments: [],
      confirmed: [],
      readRevision: 0,
      pendingWrites: 0
    }),
    [client, connState, worktreeId, enabled]
  )
  const committedRef = useRef<Owner | null>(null)
  const writesRef = useRef<CommentWriteQueues>(new WeakMap())
  const [revision, render] = useState(0)
  const isCurrent = useCallback(() => committedRef.current === owner && owner.active, [owner])
  const publish = useCallback(() => {
    if (isCurrent()) {
      render((value) => value + 1)
    }
  }, [isCurrent])
  useLayoutEffect(() => {
    committedRef.current = owner
    owner.active = true
    return () => {
      owner.active = false
    }
  }, [owner])

  const reload = useCallback(async () => {
    if (!isCurrent() || !client || !enabled || connState !== 'connected' || owner.pendingWrites) {
      return
    }
    const revision = ++owner.readRevision
    owner.loading = true
    owner.ready = false
    owner.loadError = null
    publish()
    try {
      // A returning scope must read after an earlier visit's already dispatched write.
      await writesRef.current.get(client)?.get(worktreeId)?.tail
      if (!isCurrent() || owner.readRevision !== revision) {
        return
      }
      const response = await client.sendRequest('worktree.show', { worktree: `id:${worktreeId}` })
      if (!isCurrent() || owner.readRevision !== revision) {
        return
      }
      if (!response.ok) {
        throw new Error(response.error.message || 'Unable to load review notes')
      }
      const result = response.result as { worktree?: { diffComments?: unknown } } | null
      if (
        !result?.worktree ||
        typeof result.worktree !== 'object' ||
        Array.isArray(result.worktree) ||
        (result.worktree.diffComments !== undefined && !Array.isArray(result.worktree.diffComments))
      ) {
        throw new Error('Invalid review notes response')
      }
      owner.comments = normalizeMobileDiffComments(result.worktree.diffComments, worktreeId)
      owner.confirmed = owner.comments
      owner.ready = true
    } catch (error) {
      if (isCurrent() && owner.readRevision === revision) {
        owner.loadError = error instanceof Error ? error.message : "Couldn't load review notes"
      }
    } finally {
      if (isCurrent() && owner.readRevision === revision) {
        owner.loading = false
        publish()
      }
    }
  }, [client, connState, enabled, isCurrent, owner, publish, worktreeId])
  useEffect(() => {
    void reload()
  }, [reload])

  const mutate = useCallback(
    async (
      update: (comments: DiffComment[]) => DiffComment[] | null,
      kind: 'add' | 'delete' | 'delivered',
      onStart?: () => void
    ): Promise<boolean> => {
      if (
        !isCurrent() ||
        !client ||
        !owner.ready ||
        owner.loading ||
        (kind !== 'delivered' &&
          (owner.pendingWrites > 0 ||
            writesRef.current.get(client)?.get(worktreeId)?.pendingDelivered.size))
      ) {
        return false
      }
      owner.pendingWrites++
      owner.readRevision++
      publish()
      const { targets, queue } = getCommentWriteQueue(writesRef.current, client, worktreeId)
      const prior = queue.tail
      const request = (async () => {
        await prior
        if (!isCurrent()) {
          return false
        }
        onStart?.()
        const next = update(owner.confirmed)
        if (!next) {
          return false
        }
        owner.comments = next
        publish()
        try {
          const response = await client.sendRequest('worktree.set', {
            worktree: `id:${worktreeId}`,
            diffComments: next
          })
          if (!response.ok) {
            throw new Error(response.error.message || 'Failed to save review notes')
          }
          if (!isCurrent()) {
            return false
          }
          owner.confirmed = next
          if (kind === 'add') {
            triggerSuccess()
            showToast('Note added')
          }
          if (kind === 'delete') {
            triggerSelection()
          }
          return true
        } catch (error) {
          if (isCurrent()) {
            owner.comments = owner.confirmed
            triggerError()
            showToast(error instanceof Error ? error.message : 'Failed to save review notes', 1600)
          }
          return false
        }
      })()
      const tail = request.then(
        () => undefined,
        () => undefined
      )
      queue.tail = tail
      try {
        return await request
      } finally {
        if (queue.tail === tail) {
          queue.tail = undefined
          if (queue.pendingDelivered.size === 0) {
            targets.delete(worktreeId)
            if (targets.size === 0) {
              writesRef.current.delete(client)
            }
          }
        }
        owner.pendingWrites--
        publish()
      }
    },
    [client, isCurrent, owner, publish, showToast, worktreeId]
  )

  const add = useCallback(
    (filePath: string, lineNumber: number, body: string) =>
      mutate((comments) => {
        const result = addMobileDiffComment(comments, {
          id: `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          worktreeId,
          filePath,
          lineNumber,
          body,
          createdAt: Date.now()
        })
        return result.comment ? result.comments : null
      }, 'add'),
    [mutate, worktreeId]
  )
  const remove = useCallback(
    async (id: string): Promise<void> => {
      await mutate((comments) => {
        const next = removeMobileDiffComments(comments, new Set([id]))
        return next.length === comments.length ? null : next
      }, 'delete')
    },
    [mutate]
  )
  const clearDelivered = useCallback(
    async (delivered: readonly DiffComment[]): Promise<void> => {
      const current = committedRef.current
      if (
        !client ||
        !current?.active ||
        current.client !== client ||
        current.worktreeId !== worktreeId ||
        !delivered.length
      ) {
        return
      }
      const { queue } = getCommentWriteQueue(writesRef.current, client, worktreeId)
      for (const comment of delivered) {
        queue.pendingDelivered.add(comment)
      }
      render((value) => value + 1)
      await mutate(
        (comments) => {
          const deliveredById = new Map(delivered.map((comment) => [comment.id, comment]))
          const ids = new Set(
            comments
              .filter((comment) => {
                const sent = deliveredById.get(comment.id)
                return sent && isSameMobileDiffCommentVersion(comment, sent)
              })
              .map((comment) => comment.id)
          )
          return ids.size ? removeMobileDiffComments(comments, ids) : null
        },
        'delivered',
        () => {
          for (const comment of delivered) {
            queue.pendingDelivered.delete(comment)
          }
        }
      )
    },
    [client, mutate, worktreeId]
  )
  const pendingDelivered = client
    ? writesRef.current.get(client)?.get(worktreeId)?.pendingDelivered
    : undefined
  useEffect(() => {
    if (owner.ready && !owner.loading && owner.pendingWrites === 0 && pendingDelivered?.size) {
      void clearDelivered([...pendingDelivered])
    }
  }, [clearDelivered, owner, pendingDelivered, revision])

  return {
    comments: owner.comments,
    busy: !owner.ready || owner.loading || owner.pendingWrites > 0 || !!pendingDelivered?.size,
    loading: owner.loading,
    loadError: owner.loadError,
    reload,
    add,
    remove,
    clearDelivered
  }
}
