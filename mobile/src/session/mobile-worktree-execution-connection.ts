import type { RpcClient } from '../transport/rpc-client'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'

type RepoSummary = { id: string; connectionId?: string | null }

export async function resolveMobileWorktreeExecutionConnectionId(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): Promise<string | null> {
  if (isFloatingWorkspaceWorktreeId(worktreeId)) {
    return null
  }
  const response = await client.sendRequest('repo.list')
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
  const repos = (response.result as { repos?: RepoSummary[] } | null)?.repos ?? []
  const repo = repos.find((candidate) => candidate.id === repoId)
  // Missing host metadata cannot establish that an SSH workspace runs locally.
  if (!repo) {
    throw new Error('worktree_repo_not_found')
  }
  return repo.connectionId?.trim() || null
}
