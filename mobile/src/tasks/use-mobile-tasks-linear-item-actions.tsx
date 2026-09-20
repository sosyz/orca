import type { GithubReplyMergeActionsModel } from './use-mobile-tasks-github-reply-merge-actions'
import { useCallback } from './mobile-tasks-dependencies'
import { sendLinearTaskComment } from './mobile-task-comment-rpc'
import { appendMobileTaskDetailComment } from './mobile-task-detail-comment-result'
import {
  type LinearIssue,
  type LinearIssueChild,
  type TaskItem,
  createLinearTask,
  isSuccess
} from './mobile-tasks-legacy-foundation'

export function useMobileTasksLinearItemActions(model: GithubReplyMergeActionsModel) {
  const {
    client,
    detailCommentAttempts,
    hostId,
    linearCommentDraft,
    linearSubIssueTitle,
    mutatingStatus,
    setActionItem,
    setDetailPayload,
    setError,
    setLinearCommentDraft,
    setLinearSubIssueTitle,
    setMutatingStatus
  } = model
  const addLinearComment = useCallback(
    async (item: Extract<TaskItem, { provider: 'linear' }>): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      const body = linearCommentDraft.trim()
      if (!body) {
        return
      }
      const attempt = detailCommentAttempts.begin(client, hostId, item.key, item.provider)
      if (!attempt) {
        return
      }
      setMutatingStatus(true)
      setError('')
      try {
        const comment = await sendLinearTaskComment(client, item.source, body)
        setLinearCommentDraft((current) =>
          detailCommentAttempts.isCurrent(attempt) && current === linearCommentDraft ? '' : current
        )
        setDetailPayload((current) =>
          detailCommentAttempts.isCurrent(attempt)
            ? appendMobileTaskDetailComment(current, item.provider, comment)
            : current
        )
      } catch (err) {
        if (detailCommentAttempts.isCurrent(attempt)) {
          setError(err instanceof Error ? err.message : 'Failed to add Linear comment')
        }
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, detailCommentAttempts, hostId, linearCommentDraft, mutatingStatus]
  )

  const openLinearSubIssue = useCallback(
    async (child: LinearIssueChild, workspaceId?: string): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      setMutatingStatus(true)
      setError('')
      try {
        const response = await client.sendRequest(
          'linear.getIssue',
          { id: child.id, workspaceId },
          { timeoutMs: 30_000 }
        )
        if (!isSuccess(response)) {
          throw new Error(response.error.message)
        }
        const issue = response.result as LinearIssue | null
        if (!issue) {
          throw new Error('Sub-issue not found')
        }
        setActionItem(createLinearTask(issue) as Extract<TaskItem, { provider: 'linear' }>)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Linear sub-issue')
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, mutatingStatus]
  )

  const createLinearSubIssue = useCallback(
    async (item: Extract<TaskItem, { provider: 'linear' }>): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      const title = linearSubIssueTitle.trim()
      if (!title) {
        return
      }
      setMutatingStatus(true)
      setError('')
      try {
        const response = await client.sendRequest(
          'linear.createIssue',
          {
            teamId: item.source.team.id,
            title,
            workspaceId: item.source.workspaceId,
            parentIssueId: item.source.id,
            projectId: item.source.project?.id ?? null
          },
          { timeoutMs: 30_000 }
        )
        if (!isSuccess(response)) {
          throw new Error(response.error.message)
        }
        const result = response.result as {
          ok?: boolean
          id?: string
          identifier?: string
          title?: string
          url?: string
          error?: string
        }
        if (result.ok === false || !result.id || !result.identifier) {
          throw new Error(result.error ?? 'Failed to create sub-issue')
        }
        const child: LinearIssueChild = {
          id: result.id,
          identifier: result.identifier,
          title: result.title ?? title,
          url: result.url ?? ''
        }
        setLinearSubIssueTitle('')
        setDetailPayload((current) =>
          current?.provider === 'linear'
            ? {
                ...current,
                children: current.children.some((entry) => entry.id === child.id)
                  ? current.children
                  : [...current.children, child]
              }
            : current
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create Linear sub-issue')
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, linearSubIssueTitle, mutatingStatus]
  )
  return Object.assign(model, { addLinearComment, openLinearSubIssue, createLinearSubIssue })
}

export type LinearItemActionsModel = ReturnType<typeof useMobileTasksLinearItemActions>
