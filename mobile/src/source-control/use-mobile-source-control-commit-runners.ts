import { useCallback } from 'react'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { LoadStatusOptions } from './mobile-source-control-screen-state'
import type {
  MobileCommitFailureRecovery,
  RecordMobileCommitFailure
} from './mobile-commit-failure-recovery'
import type { MobileSourceControlBusyClaim } from './use-mobile-source-control-workflow-owner'

type GitStep = { method: string; params?: Record<string, unknown> }
type SendGitRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>
type RunGitWorkflow = (
  actionId: string,
  runner: () => Promise<void>,
  options?: { clearCommitMessage?: boolean }
) => Promise<boolean>

type Params = {
  commitMessage: string
  stagedEntries: MobileCommitFailureRecovery['stagedEntries']
  sendGitRequest: SendGitRequest
  sendCommitRequest: (message: string) => Promise<unknown>
  runGitSyncSteps: () => Promise<void>
  runGitWorkflow: RunGitWorkflow
  loadStatus: (options?: LoadStatusOptions) => Promise<boolean>
  isCurrentOwner: () => boolean
  claimBusy: (actionId: string) => MobileSourceControlBusyClaim | null
  releaseBusy: (claim: MobileSourceControlBusyClaim) => void
  setActionError: (next: string | null) => void
  setCommitMessage: (next: string) => void
  recordCommitFailure: RecordMobileCommitFailure
}

// Commit + commit-then-action runners. Split from the main runners hook to keep
// each file under the line limit; behavior is unchanged from the original.
export function useMobileSourceControlCommitRunners(params: Params) {
  const {
    commitMessage,
    stagedEntries,
    sendGitRequest,
    sendCommitRequest,
    runGitSyncSteps,
    runGitWorkflow,
    loadStatus,
    isCurrentOwner,
    claimBusy,
    releaseBusy,
    setActionError,
    setCommitMessage,
    recordCommitFailure
  } = params

  const commit = useCallback(async () => {
    const message = commitMessage.trim()
    if (!message) {
      return false
    }
    return await runGitWorkflow(
      'commit',
      async () => {
        try {
          await sendCommitRequest(message)
        } catch (err) {
          if (isCurrentOwner()) {
            recordCommitFailure({
              error: err instanceof Error ? err.message : 'Commit failed',
              commitMessage: message,
              stagedEntries
            })
          }
          throw err
        }
      },
      { clearCommitMessage: true }
    )
  }, [
    commitMessage,
    isCurrentOwner,
    recordCommitFailure,
    runGitWorkflow,
    sendCommitRequest,
    stagedEntries
  ])

  const runCommitFollowUps = useCallback(
    async (actionId: string, afterCommit: () => Promise<void>) => {
      const message = commitMessage.trim()
      if (!message) {
        return false
      }
      const claim = claimBusy(actionId)
      if (!claim) {
        return false
      }
      setActionError(null)
      recordCommitFailure(null)
      let didCommit = false
      try {
        await sendCommitRequest(message)
        didCommit = true
        if (!isCurrentOwner()) {
          return false
        }
        await afterCommit()
        if (!isCurrentOwner()) {
          return false
        }
        setCommitMessage('')
        triggerSuccess()
        await loadStatus({ preserveReadyOnFailure: true, force: true })
        return isCurrentOwner()
      } catch (err) {
        if (!isCurrentOwner()) {
          return false
        }
        triggerError()
        const errorMessage = err instanceof Error ? err.message : 'Source control action failed'
        if (!didCommit) {
          recordCommitFailure({ error: errorMessage, commitMessage: message, stagedEntries })
        }
        if (didCommit) {
          setCommitMessage('')
          await loadStatus({
            preserveReadyOnFailure: true,
            clearActionErrorOnSuccess: false,
            force: true
          })
          if (!isCurrentOwner()) {
            return false
          }
        }
        setActionError(errorMessage)
        return false
      } finally {
        releaseBusy(claim)
      }
    },
    [
      claimBusy,
      commitMessage,
      isCurrentOwner,
      loadStatus,
      recordCommitFailure,
      releaseBusy,
      sendCommitRequest,
      setActionError,
      setCommitMessage,
      stagedEntries
    ]
  )

  const runCommitSequence = useCallback(
    async (actionId: string, afterCommit: GitStep[]) => {
      return await runCommitFollowUps(actionId, async () => {
        for (const step of afterCommit) {
          if (!isCurrentOwner()) {
            return
          }
          await sendGitRequest<unknown>(step.method, step.params)
        }
      })
    },
    [isCurrentOwner, runCommitFollowUps, sendGitRequest]
  )

  const runCommitSyncSequence = useCallback(async () => {
    return await runCommitFollowUps('commit-sync', runGitSyncSteps)
  }, [runCommitFollowUps, runGitSyncSteps])

  return { commit, runCommitSequence, runCommitSyncSequence }
}
