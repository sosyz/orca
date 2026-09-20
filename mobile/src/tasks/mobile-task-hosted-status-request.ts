import type { RpcClient } from '../transport/rpc-client'

type GitHubStatusTarget = {
  repoId: string
  number: number
  type: 'issue' | 'pr'
  state: 'open' | 'closed' | 'merged' | 'draft'
}

type GitLabStatusTarget = {
  repoId: string
  number: number
  type: 'issue' | 'mr'
  state: 'opened' | 'closed' | 'merged' | 'locked' | 'draft'
  projectRef?: { host: string; path: string }
}

export function requestGitHubTaskStatus(client: RpcClient, source: GitHubStatusTarget) {
  const nextState = source.state === 'closed' ? 'open' : 'closed'
  return source.type === 'issue'
    ? client.sendRequest('github.updateIssue', {
        repo: `id:${source.repoId}`,
        number: source.number,
        updates: { state: nextState }
      })
    : client.sendRequest('github.updatePRState', {
        repo: `id:${source.repoId}`,
        prNumber: source.number,
        updates: { state: nextState }
      })
}

export function requestGitLabTaskStatus(client: RpcClient, source: GitLabStatusTarget) {
  const nextState = source.state === 'closed' ? 'opened' : 'closed'
  return source.type === 'issue'
    ? client.sendRequest('gitlab.updateIssue', {
        repo: `id:${source.repoId}`,
        number: source.number,
        updates: { state: nextState },
        projectRef: source.projectRef
      })
    : client.sendRequest('gitlab.updateMRState', {
        repo: `id:${source.repoId}`,
        iid: source.number,
        state: nextState,
        projectRef: source.projectRef
      })
}
