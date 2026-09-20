import { useCallback, useMemo } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalPromptLaunch } from '../session/use-mobile-terminal-prompt-launch'
import {
  buildFixCommitFailurePrompt,
  type MobileCommitFailureRecovery,
  hasExpandedCommitFailureDetails,
  summarizeCommitFailure
} from './mobile-commit-failure-recovery'

type Params = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  failure: MobileCommitFailureRecovery | null
}

export function useMobileCommitFailureRecovery({ client, connState, worktreeId, failure }: Params) {
  const launcher = useMobileTerminalPromptLaunch<'commit-failure'>({
    client,
    connState,
    worktreeId,
    target: failure
  })
  const summary = useMemo(() => (failure ? summarizeCommitFailure(failure.error) : null), [failure])

  const hasDetails = useMemo(
    () => (failure && summary ? hasExpandedCommitFailureDetails(failure.error, summary) : false),
    [failure, summary]
  )
  const prompt = useMemo(
    () =>
      failure && summary
        ? buildFixCommitFailurePrompt({
            summary,
            error: failure.error,
            entries: failure.stagedEntries,
            worktreePath: null,
            commitMessage: failure.commitMessage
          })
        : null,
    [failure, summary]
  )

  const launchPrompt = launcher.launch
  const launch = useCallback(async (): Promise<boolean> => {
    if (!prompt) {
      return false
    }
    return launchPrompt('commit-failure', () => prompt)
  }, [launchPrompt, prompt])

  return {
    summary,
    hasDetails,
    launching: launcher.isBusy('commit-failure'),
    launchError: launcher.error,
    launch
  }
}

export type MobileCommitFailureRecoveryAction = ReturnType<typeof useMobileCommitFailureRecovery>
