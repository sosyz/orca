import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError } from '../platform/haptics'
import type { MobileGitStatusResult } from './mobile-git-status'
import type { LoadStatusOptions } from './mobile-source-control-screen-state'
import {
  getMobileCommitFailureStagedEntries,
  type MobileCommitFailureRecovery,
  type RecordMobileCommitFailure
} from './mobile-commit-failure-recovery'
import {
  mobileHostedReviewCreateIntentProgressMessage,
  type MobileHostedReviewCreateIntentProgress
} from './mobile-hosted-review-create-intent'
import {
  isMobileHostedReviewCommitFailure,
  runMobileHostedReviewCreateIntent,
  type MobileHostedReviewCreateIntentRunOutcome
} from './mobile-hosted-review-create-intent-runner'

type RunGitWorkflow = (actionId: string, runner: () => Promise<void>) => Promise<boolean>
type LoadStatus = (options?: LoadStatusOptions) => Promise<boolean>

type Params = {
  client: RpcClient | null
  worktreeId: string
  status: MobileGitStatusResult | null
  branchLabel: string
  commitMessage: string
  stagedEntries: MobileCommitFailureRecovery['stagedEntries']
  isCurrentOwner: () => boolean
  runGitWorkflow: RunGitWorkflow
  loadStatus: LoadStatus
  setActionError: (next: string | null) => void
  setCommitMessage: (next: string) => void
  setShowActionSheet: (next: boolean) => void
  setCreatedPrUrl: (next: string | null) => void
  setCreatedPrWarning: (next: string | null) => void
  recordCommitFailure: RecordMobileCommitFailure
}

export function useMobileCreatePrRunner({
  client,
  worktreeId,
  status,
  branchLabel,
  commitMessage,
  stagedEntries,
  isCurrentOwner,
  runGitWorkflow,
  loadStatus,
  setActionError,
  setCommitMessage,
  setShowActionSheet,
  setCreatedPrUrl,
  setCreatedPrWarning,
  recordCommitFailure
}: Params) {
  return useCallback(
    async (pushFirst: boolean) => {
      if (!isCurrentOwner()) {
        return
      }
      setShowActionSheet(false)
      const branch = status?.branch
      if (!client || !branch) {
        triggerError()
        setActionError('Check out a branch before creating a pull request.')
        return
      }
      const ownedClient: Pick<RpcClient, 'sendRequest'> = {
        sendRequest: async (...args) => {
          if (!isCurrentOwner()) {
            throw new Error('Source control connection changed')
          }
          const response = await client.sendRequest(...args)
          if (!isCurrentOwner()) {
            throw new Error('Source control connection changed')
          }
          return response
        }
      }
      const created: { current: MobileHostedReviewCreateIntentRunOutcome | null } = {
        current: null
      }
      let progress: MobileHostedReviewCreateIntentProgress | null = null
      const ran = await runGitWorkflow(pushFirst ? 'push-create-pr' : 'create-pr', async () => {
        created.current = await runMobileHostedReviewCreateIntent(ownedClient, worktreeId, {
          branch,
          title: branchLabel,
          status,
          commitMessage,
          onProgress: (nextProgress: MobileHostedReviewCreateIntentProgress) => {
            if (isCurrentOwner()) {
              progress = nextProgress
              setActionError(mobileHostedReviewCreateIntentProgressMessage(nextProgress))
            }
          }
        })
        if (!created.current.ok) {
          throw new Error(created.current.error)
        }
      })
      if (!isCurrentOwner()) {
        return
      }
      const outcome = created.current
      if (outcome?.committed) {
        setCommitMessage('')
      }
      if (!ran && outcome?.status !== undefined) {
        await loadStatus({
          preserveReadyOnFailure: true,
          clearActionErrorOnSuccess: false,
          force: true
        })
      }
      if (!isCurrentOwner()) {
        return
      }
      if (!ran || !outcome || !outcome.ok) {
        if (!ran && outcome && isMobileHostedReviewCommitFailure(outcome, progress)) {
          const outcomeStagedEntries = getMobileCommitFailureStagedEntries(outcome.status?.entries)
          recordCommitFailure({
            error: outcome.error,
            commitMessage: outcome.commitMessage ?? commitMessage.trim(),
            stagedEntries: outcomeStagedEntries.length > 0 ? outcomeStagedEntries : stagedEntries
          })
        }
        return
      }
      setActionError(null)
      setCreatedPrUrl(outcome.url)
      setCreatedPrWarning(outcome.warning ?? null)
    },
    [
      branchLabel,
      client,
      commitMessage,
      loadStatus,
      isCurrentOwner,
      recordCommitFailure,
      runGitWorkflow,
      setActionError,
      setCommitMessage,
      setCreatedPrUrl,
      setCreatedPrWarning,
      setShowActionSheet,
      stagedEntries,
      status,
      worktreeId
    ]
  )
}
