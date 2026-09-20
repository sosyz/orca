import type { RpcClient } from '../transport/rpc-client'

export type DetailComment = {
  id: string | number
  author?: string
  authorAvatarUrl?: string
  user?: { displayName?: string }
  isBot?: boolean
  body: string
  createdAt?: string
  url?: string
  reactions?: Array<{
    content:
      | 'thumbs_up'
      | 'thumbs_down'
      | 'laugh'
      | 'confused'
      | 'heart'
      | 'hooray'
      | 'rocket'
      | 'eyes'
    count: number
  }>
  path?: string
  line?: number
  startLine?: number
  threadId?: string
  isResolved?: boolean
}

type HostedCommentTarget =
  | { provider: 'github'; source: { repoId: string; number: number; type: 'issue' | 'pr' } }
  | {
      provider: 'gitlab'
      source: {
        repoId: string
        number: number
        type: 'issue' | 'mr'
        projectRef?: { host: string; path: string }
      }
    }

export async function sendHostedTaskComment(
  client: RpcClient,
  item: HostedCommentTarget,
  body: string
): Promise<DetailComment> {
  const response =
    item.provider === 'github'
      ? await client.sendRequest(
          'github.addIssueComment',
          {
            repo: `id:${item.source.repoId}`,
            number: item.source.number,
            body,
            type: item.source.type
          },
          { timeoutMs: 30_000 }
        )
      : await client.sendRequest(
          item.source.type === 'mr' ? 'gitlab.addMRComment' : 'gitlab.addIssueComment',
          item.source.type === 'mr'
            ? {
                repo: `id:${item.source.repoId}`,
                iid: item.source.number,
                body,
                projectRef: item.source.projectRef
              }
            : {
                repo: `id:${item.source.repoId}`,
                number: item.source.number,
                body,
                projectRef: item.source.projectRef
              },
          { timeoutMs: 30_000 }
        )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const result = response.result as { ok?: boolean; error?: string; comment?: DetailComment }
  if (result.ok === false) {
    throw new Error(result.error ?? 'Failed to add comment')
  }
  return (
    result.comment ?? {
      id: `local-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      author: 'You'
    }
  )
}

export async function sendLinearTaskComment(
  client: RpcClient,
  issue: { id: string; workspaceId?: string },
  body: string
): Promise<DetailComment> {
  const response = await client.sendRequest(
    'linear.addIssueComment',
    { issueId: issue.id, workspaceId: issue.workspaceId, body },
    { timeoutMs: 30_000 }
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const result = response.result as { ok?: boolean; id?: string; error?: string }
  if (result.ok === false) {
    throw new Error(result.error ?? 'Failed to add comment')
  }
  return {
    id: result.id ?? `local-${Date.now()}`,
    body,
    createdAt: new Date().toISOString(),
    user: { displayName: 'You' }
  }
}
