import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { resolveMobileBranchCompareBaseRef } from './mobile-branch-base-ref'

type GitStep = { method: string; params?: Record<string, unknown> }
type SendGitRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>
type RunGitWorkflow = (actionId: string, runner: () => Promise<void>) => Promise<boolean>

type Params = {
  client: RpcClient | null
  worktreeId: string
  sendGitRequest: SendGitRequest
  runGitWorkflow: RunGitWorkflow
  runGitSequence: (actionId: string, steps: GitStep[]) => Promise<boolean>
  runGitSync: (actionId: string) => Promise<boolean>
  commit: () => Promise<boolean>
  runCommitSequence: (actionId: string, afterCommit: GitStep[]) => Promise<boolean>
  runCommitSyncSequence: () => Promise<boolean>
  isCurrentOwner: () => boolean
  setShowActionSheet: (next: boolean) => void
}

// The action-sheet entry runners: each performs an action then dismisses the
// sheet. Split from the main runners hook to stay under the line limit.
export function useMobileSourceControlActionSheetRunners(params: Params) {
  const {
    client,
    worktreeId,
    sendGitRequest,
    runGitWorkflow,
    runGitSequence,
    runGitSync,
    commit,
    runCommitSequence,
    runCommitSyncSequence,
    isCurrentOwner,
    setShowActionSheet
  } = params
  const closeIfCurrent = useCallback(() => {
    if (isCurrentOwner()) {
      setShowActionSheet(false)
    }
  }, [isCurrentOwner, setShowActionSheet])

  const runActionSheetCommit = useCallback(async () => {
    await commit()
    closeIfCurrent()
  }, [closeIfCurrent, commit])

  const runActionSheetCommitSequence = useCallback(
    async (actionId: string, afterCommit: GitStep[]) => {
      await runCommitSequence(actionId, afterCommit)
      closeIfCurrent()
    },
    [closeIfCurrent, runCommitSequence]
  )

  const runActionSheetCommitSync = useCallback(async () => {
    await runCommitSyncSequence()
    closeIfCurrent()
  }, [closeIfCurrent, runCommitSyncSequence])

  const runActionSheetGitSequence = useCallback(
    async (actionId: string, steps: GitStep[]) => {
      await runGitSequence(actionId, steps)
      closeIfCurrent()
    },
    [closeIfCurrent, runGitSequence]
  )

  const runActionSheetGitSync = useCallback(async () => {
    await runGitSync('sync')
    closeIfCurrent()
  }, [closeIfCurrent, runGitSync])

  const runActionSheetRebase = useCallback(async () => {
    await runGitWorkflow('rebase', async () => {
      if (!client) {
        throw new Error('Waiting for desktop...')
      }
      const baseRef = await resolveMobileBranchCompareBaseRef(client, worktreeId)
      if (!baseRef) {
        throw new Error('No base branch to rebase onto')
      }
      await sendGitRequest<unknown>('git.rebaseFromBase', { baseRef })
    })
    closeIfCurrent()
  }, [client, closeIfCurrent, runGitWorkflow, sendGitRequest, worktreeId])

  return {
    runActionSheetCommit,
    runActionSheetCommitSequence,
    runActionSheetCommitSync,
    runActionSheetGitSequence,
    runActionSheetGitSync,
    runActionSheetRebase
  }
}
