import type { Repo } from '../../../src/shared/repo-types'
import {
  getExecutionHostLabel,
  getLocalExecutionHostLabel,
  getRepoExecutionHostId,
  parseExecutionHostId
} from '../../../src/shared/execution-host'
import {
  getProjectIdentityKey,
  getProjectProviderIdentity
} from '../../../src/shared/project-host-setup-projection'

type WorkspaceRepo = Pick<Repo, 'id' | 'displayName' | 'path'> &
  Partial<
    Pick<Repo, 'connectionId' | 'executionHostId' | 'upstream' | 'repoIcon' | 'gitRemoteIdentity'>
  >

type NewWorkspaceTargetTranslator = (
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) => string

export type NewWorkspaceProjectTargetCopy = {
  hostsConfigured: (count: number) => string
  remotePrefix: string
  sshPrefix: string
  thisComputer: string
}

const DEFAULT_PROJECT_TARGET_COPY: NewWorkspaceProjectTargetCopy = {
  hostsConfigured: (count) => `${count} hosts configured`,
  remotePrefix: 'Remote',
  sshPrefix: 'SSH',
  thisComputer: 'This computer'
}

export function createNewWorkspaceProjectTargetCopy(
  t: NewWorkspaceTargetTranslator
): NewWorkspaceProjectTargetCopy {
  return {
    hostsConfigured: (count) =>
      t('mobile.workspace.target.hostsConfigured', '{{count}} hosts configured', { count }),
    remotePrefix: t('mobile.workspace.target.remotePrefix', 'Remote'),
    sshPrefix: t('mobile.workspace.target.sshPrefix', 'SSH'),
    thisComputer: t('mobile.workspace.target.thisComputer', 'This computer')
  }
}

export type NewWorkspaceProjectOption<TRepo extends WorkspaceRepo> = {
  id: string
  label: string
  detail?: string
  repo: TRepo
}

export type NewWorkspaceRunTargetOption<TRepo extends WorkspaceRepo> = {
  id: string
  label: string
  detail: string
  repo: TRepo
}

export function buildNewWorkspaceProjectOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[],
  copy: NewWorkspaceProjectTargetCopy = DEFAULT_PROJECT_TARGET_COPY
): NewWorkspaceProjectOption<TRepo>[] {
  const options = new Map<string, NewWorkspaceProjectOption<TRepo>>()
  const hostIdsByProject = new Map<string, Set<string>>()
  for (const repo of repos) {
    const id = getProjectIdentityKey(repo)
    const hostIds = hostIdsByProject.get(id) ?? new Set<string>()
    hostIds.add(getRepoExecutionHostId(repo))
    hostIdsByProject.set(id, hostIds)
    if (!options.has(id)) {
      options.set(id, {
        id,
        label: repo.displayName,
        repo
      })
    }
  }
  return [...options.values()].map((option) => {
    const providerIdentity = getProjectProviderIdentity(option.repo)
    const providerDetail = providerIdentity
      ? `${providerIdentity.owner}/${providerIdentity.repo}`
      : ''
    const hostCount = hostIdsByProject.get(option.id)?.size ?? 0
    const detail = providerDetail || (hostCount > 1 ? copy.hostsConfigured(hostCount) : '')
    return detail ? { ...option, detail } : option
  })
}

export function getNewWorkspaceRunTarget(
  repo: WorkspaceRepo,
  localPlatform: NodeJS.Platform | null = null,
  copy: NewWorkspaceProjectTargetCopy = DEFAULT_PROJECT_TARGET_COPY
): {
  label: string
  detail: string
} {
  const hostId = getRepoExecutionHostId(repo)
  const host = parseExecutionHostId(hostId)
  const hostLabel = getExecutionHostLabel(hostId)
  if (host?.kind === 'ssh') {
    return { label: `${copy.sshPrefix} · ${hostLabel}`, detail: repo.path }
  }
  if (host?.kind === 'runtime') {
    return { label: `${copy.remotePrefix} · ${hostLabel}`, detail: repo.path }
  }
  return {
    label: localPlatform ? getLocalExecutionHostLabel(localPlatform) : copy.thisComputer,
    detail: repo.path
  }
}

export function buildNewWorkspaceRunTargetOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[],
  projectId: string | null,
  localPlatform: NodeJS.Platform | null = null,
  copy: NewWorkspaceProjectTargetCopy = DEFAULT_PROJECT_TARGET_COPY
): NewWorkspaceRunTargetOption<TRepo>[] {
  if (!projectId) {
    return []
  }
  const options = new Map<string, NewWorkspaceRunTargetOption<TRepo>>()
  for (const repo of repos) {
    if (getProjectIdentityKey(repo) !== projectId) {
      continue
    }
    const hostId = getRepoExecutionHostId(repo)
    if (!options.has(hostId)) {
      options.set(hostId, {
        id: repo.id,
        ...getNewWorkspaceRunTarget(repo, localPlatform, copy),
        repo
      })
    }
  }
  return [...options.values()]
}
