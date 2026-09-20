import { useMemo } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import type { GitHubPrRepoSlug } from './github-pr-rpc'
import { githubRepoIdentityKey } from '../../../src/shared/github/repository-identity-key'
import { useMobileTerminalPromptLaunch } from './use-mobile-terminal-prompt-launch'

export type PrAiTriageKey = 'fix-checks' | 'resolve-conflicts'

type Input = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  prNumber: number
  prRepo?: GitHubPrRepoSlug | null
}

export function useMobilePrAiTriage(input: Input) {
  const { client, connState, worktreeId, prNumber, prRepo } = input
  const repoKey = prRepo ? githubRepoIdentityKey(prRepo) : ''
  const target = useMemo(() => (prNumber > 0 ? { prNumber, repoKey } : null), [prNumber, repoKey])
  return useMobileTerminalPromptLaunch<PrAiTriageKey>({ client, connState, worktreeId, target })
}

export type MobilePrAiTriage = ReturnType<typeof useMobilePrAiTriage>
