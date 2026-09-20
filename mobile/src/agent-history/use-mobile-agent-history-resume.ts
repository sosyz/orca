import { useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { RpcClient } from '../transport/rpc-client'
import type { Worktree } from '../worktree/workspace-list-types'
import {
  buildMobileAiVaultResumeLaunch,
  createMobileAiVaultResumeMutationRegistry,
  resolveMobileAiVaultResumePlatform,
  resumeAiVaultSessionInTerminal,
  type MobileAiVaultResumeSettings,
  type MobileAiVaultResumeMutationRegistry
} from '../session/ai-vault-resume-launch'
import {
  prepareMobileAiVaultSessionResume,
  RESUME_RPC_TIMEOUT_MS
} from '../session/ai-vault-resume-preparation'
import { triggerError, triggerSuccess } from '../platform/haptics'
import {
  resolveMobileAiVaultSessionResumeTarget,
  type MobileAiVaultResumeRepo,
  type MobileAiVaultResumeFolderWorkspace,
  type MobileAiVaultResumeProjectGroup
} from './agent-history-resume-target'

type ResumeScope = { client: RpcClient | null; hostId: string; worktreeId: string }
type ResumeAttempt = ResumeScope & { sessionId: string }

function sameScope(left: ResumeScope, right: ResumeScope): boolean {
  return (
    left.client === right.client &&
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId
  )
}

export function useMobileAgentHistoryResume(
  args: ResumeScope & {
    connected: boolean
    worktrees: readonly Worktree[]
    hostPlatform: NodeJS.Platform | null
    hostTerminalWindowsShell: string | null
    navigate: (hostId: string, worktreeId: string) => void
  }
) {
  const { client, hostId, worktreeId, connected } = args
  const scope = useMemo(() => ({ client, hostId, worktreeId }), [client, hostId, worktreeId])
  const committedOwner = useRef<{ scope: ResumeScope; connected: boolean } | null>(null)
  const attempts = useRef(new Set<ResumeAttempt>())
  const registries = useRef(
    new WeakMap<RpcClient, Map<string, MobileAiVaultResumeMutationRegistry>>()
  )
  const [, render] = useReducer((revision: number) => revision + 1, 0)
  const [feedback, setFeedback] = useState<{ scope: ResumeScope; message: string | null } | null>(
    null
  )

  useLayoutEffect(() => {
    const owner = { scope, connected }
    committedOwner.current = owner
    return () => {
      committedOwner.current = null
    }
  }, [scope, connected])

  async function onResumeSession(session: AiVaultSession): Promise<void> {
    const owner = committedOwner.current
    if (
      !owner ||
      owner.scope !== scope ||
      [...attempts.current].some((attempt) => sameScope(attempt, scope))
    ) {
      return
    }
    const isCurrent = () => committedOwner.current === owner
    const showMessage = (message: string | null) => setFeedback({ scope, message })
    if (!client || !owner.connected) {
      showMessage('Waiting for host...')
      triggerError()
      return
    }
    if (!session.sessionId) {
      showMessage('This session is missing a resume id.')
      triggerError()
      return
    }
    let byWorkspace = registries.current.get(client)
    if (!byWorkspace) {
      byWorkspace = new Map()
      registries.current.set(client, byWorkspace)
    }
    const registryKey = JSON.stringify([hostId, worktreeId])
    let registry = byWorkspace.get(registryKey)
    if (!registry) {
      registry = createMobileAiVaultResumeMutationRegistry(createMobileAiVaultResumeMutationId)
      byWorkspace.set(registryKey, registry)
    }
    const attempt = { ...scope, sessionId: session.id }
    attempts.current.add(attempt)
    showMessage(null)
    try {
      const {
        repos,
        folderWorkspaces,
        projectGroups,
        settings,
        worktrees: freshWorktrees
      } = await loadMobileResumeMetadata(client)
      if (!isCurrent()) {
        return
      }
      const target = resolveMobileAiVaultSessionResumeTarget({
        session,
        activeWorktreeId: worktreeId,
        worktrees: freshWorktrees ?? args.worktrees,
        repos,
        folderWorkspaces,
        projectGroups
      })
      if (target.status !== 'ready') {
        showMessage(target.message)
        triggerError()
        return
      }
      const platform = resolveMobileAiVaultResumePlatform(
        target.targetStatus,
        args.hostPlatform,
        target.workspacePath,
        target.terminalPlatform
      )
      if (!platform) {
        showMessage('Unable to determine host platform.')
        triggerError()
        return
      }
      const preparedSession = await prepareMobileAiVaultSessionResume(client, session)
      if (!isCurrent()) {
        return
      }
      const launch = buildMobileAiVaultResumeLaunch({
        session: preparedSession,
        hostPlatform: platform,
        hostTerminalWindowsShell: args.hostTerminalWindowsShell,
        settings
      })
      const resumed = await resumeAiVaultSessionInTerminal(
        client,
        target.worktreeId,
        {
          ...launch,
          clientMutationId: registry.claim(session.id)
        },
        isCurrent
      )
      if (!resumed) {
        return
      }
      registry.releaseOnSuccess(session.id)
      if (!isCurrent()) {
        return
      }
      triggerSuccess()
      showMessage('Agent session queued.')
      args.navigate(hostId, target.worktreeId)
    } catch (err) {
      if (!isCurrent()) {
        return
      }
      triggerError()
      showMessage(err instanceof Error ? err.message : 'Failed to resume session.')
    } finally {
      attempts.current.delete(attempt)
      if (committedOwner.current) {
        render()
      }
    }
  }

  return {
    onResumeSession,
    resumingSessionId:
      [...attempts.current].find((attempt) => sameScope(attempt, scope))?.sessionId ?? null,
    resumeMessage: feedback?.scope === scope ? feedback.message : null
  }
}

async function loadMobileResumeMetadata(client: Pick<RpcClient, 'sendRequest'>): Promise<{
  repos: MobileAiVaultResumeRepo[]
  folderWorkspaces: MobileAiVaultResumeFolderWorkspace[]
  projectGroups: MobileAiVaultResumeProjectGroup[]
  settings: MobileAiVaultResumeSettings | null
  worktrees: Worktree[] | null
}> {
  // Why: repo.list can enrich repo remote identities, so fetch resume-only
  // metadata after explicit user intent instead of delaying history browsing.
  // timeoutMs: without it a socket drop parks these on the reconnect waiter
  // for minutes, pinning the resume spinner (see RESUME_RPC_TIMEOUT_MS).
  const [
    repoResponse,
    folderWorkspaceResponse,
    projectGroupResponse,
    settingsResponse,
    worktreeResponse
  ] = await Promise.all([
    client.sendRequest('repo.list', undefined, { timeoutMs: RESUME_RPC_TIMEOUT_MS }),
    client
      .sendRequest('folderWorkspace.list', undefined, { timeoutMs: RESUME_RPC_TIMEOUT_MS })
      .catch(() => null),
    client
      .sendRequest('projectGroup.list', undefined, { timeoutMs: RESUME_RPC_TIMEOUT_MS })
      .catch(() => null),
    client
      .sendRequest('settings.get', undefined, { timeoutMs: RESUME_RPC_TIMEOUT_MS })
      .catch(() => null),
    client
      .sendRequest('worktree.ps', { limit: 10000 }, { timeoutMs: RESUME_RPC_TIMEOUT_MS })
      .catch(() => null)
  ])
  if (!repoResponse.ok) {
    throw new Error(repoResponse.error?.message || 'Unable to load workspace metadata.')
  }
  const repoResult = repoResponse.result as { repos?: MobileAiVaultResumeRepo[] }
  const folderWorkspaceResult =
    folderWorkspaceResponse?.ok === true
      ? (folderWorkspaceResponse.result as {
          folderWorkspaces?: MobileAiVaultResumeFolderWorkspace[]
        })
      : null
  const projectGroupResult =
    projectGroupResponse?.ok === true
      ? (projectGroupResponse.result as { groups?: MobileAiVaultResumeProjectGroup[] })
      : null
  const settingsResult =
    settingsResponse?.ok === true
      ? (settingsResponse.result as { settings?: MobileAiVaultResumeSettings })
      : null
  const worktreeResult =
    worktreeResponse?.ok === true ? (worktreeResponse.result as { worktrees?: Worktree[] }) : null
  return {
    repos: repoResult.repos ?? [],
    folderWorkspaces: folderWorkspaceResult?.folderWorkspaces ?? [],
    projectGroups: projectGroupResult?.groups ?? [],
    settings: settingsResult?.settings ?? null,
    worktrees: worktreeResult?.worktrees ?? null
  }
}

function createMobileAiVaultResumeMutationId(sessionId: string): string {
  const sessionPart = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64) || 'session'
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `ai-vault-resume:${sessionPart}:${Date.now().toString(36)}:${randomPart}`
}
