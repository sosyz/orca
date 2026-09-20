import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import type { GitHubPrRepoSlug } from './github-pr-rpc'
import { fetchUpdatePRTitle, type GitHubPrMutationOutcome } from './github-pr-mutations'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { buildUpdatePRTitleParams } from './pr-title-edit'
import { githubRepoIdentityKey } from '../../../src/shared/github/repository-identity-key'

export type PrTitleMutations = {
  updateTitle: (args: {
    prNumber: number
    title: string
    prRepo?: GitHubPrRepoSlug | null
  }) => Promise<GitHubPrMutationOutcome>
}

export type PrTitleActionInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  prNumber: number
  prRepo?: GitHubPrRepoSlug | null
  // Re-fetches authoritative PR data after a successful title edit so the new
  // title appears (mobile keeps it simple with a full refetch, like the other actions).
  refetch: () => void | Promise<void>
  // Test seam: inject fake mutations; defaults to the real github.* wrapper.
  mutations?: PrTitleMutations
}

function realMutations(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): PrTitleMutations {
  return {
    updateTitle: (args) => fetchUpdatePRTitle(client, worktreeId, args)
  }
}

// React adapter for the inline title edit. Tracks in-flight + error state,
// fires haptics, and refetches on success. Empty/unchanged drafts short-circuit to a
// successful no-op (the caller closes the editor) without a host round-trip.
export function useMobilePrTitleAction(input: PrTitleActionInput) {
  const { client, connState, worktreeId, prNumber, prRepo, refetch } = input
  const repoKey = prRepo ? githubRepoIdentityKey(prRepo) : ''
  const owner = useMemo(
    () => ({ client, worktreeId, connState, prNumber, repoKey }),
    [client, worktreeId, connState, prNumber, repoKey]
  )
  const committedOwner = useRef<typeof owner | null>(null)
  const attempts = useRef(new Set<{ owner: typeof owner }>())
  const [, refreshBusy] = useReducer((revision: number) => revision + 1, 0)
  const [failure, setFailure] = useState<{ owner: typeof owner; message: string } | null>(null)
  useLayoutEffect(() => {
    committedOwner.current = owner
    return () => {
      if (committedOwner.current === owner) {
        committedOwner.current = null
      }
    }
  }, [owner])

  const mutations = useMemo(
    () => input.mutations ?? (client ? realMutations(client, worktreeId) : null),
    [input.mutations, client, worktreeId]
  )
  const ready =
    prNumber > 0 &&
    mutations !== null &&
    (input.mutations !== undefined || connState === 'connected')

  const setTitle = useCallback(
    async (draft: string, current: string): Promise<boolean> => {
      const isCurrent = () => committedOwner.current === owner
      if (!isCurrent()) {
        return false
      }
      const params = buildUpdatePRTitleParams(prNumber, draft, current)
      // No-op when empty/unchanged: report success so the editor closes silently.
      if (!params) {
        return true
      }
      for (const attempt of attempts.current) {
        const source = attempt.owner
        if (
          source.client === client &&
          source.worktreeId === worktreeId &&
          source.prNumber === prNumber &&
          source.repoKey === repoKey
        ) {
          return false
        }
      }
      // Why: surface an explicit error when offline/not-ready so Save doesn't
      // silently no-op (the editor stays open with a reason instead of nothing).
      if (!ready || !mutations) {
        setFailure({ owner, message: 'Not connected to desktop.' })
        return false
      }
      const attempt = { owner }
      attempts.current.add(attempt)
      refreshBusy()
      setFailure(null)
      try {
        const outcome = await mutations.updateTitle({ ...params, prRepo })
        if (!isCurrent()) {
          return false
        }
        if (outcome.ok) {
          await refetch()
          if (!isCurrent()) {
            return false
          }
          triggerSuccess()
          return true
        }
        triggerError()
        setFailure({ owner, message: outcome.error })
        return false
      } catch (err) {
        // Why: updateTitle/refetch can throw; without this the `void save()`
        // rejection is unhandled — set the error + error haptic and return false.
        if (isCurrent()) {
          triggerError()
          setFailure({
            owner,
            message: err instanceof Error ? err.message : 'Failed to update title.'
          })
        }
        return false
      } finally {
        attempts.current.delete(attempt)
        if (committedOwner.current) {
          refreshBusy()
        }
      }
    },
    [ready, mutations, client, worktreeId, prNumber, prRepo, repoKey, owner, refetch]
  )

  return {
    ready,
    saving: [...attempts.current].some(
      ({ owner: source }) =>
        source.client === client &&
        source.worktreeId === worktreeId &&
        source.connState === connState &&
        source.prNumber === prNumber &&
        source.repoKey === repoKey
    ),
    error: failure?.owner === owner ? failure.message : null,
    clearError: useCallback(() => {
      if (committedOwner.current === owner) {
        setFailure(null)
      }
    }, [owner]),
    setTitle
  }
}

export type MobilePrTitleAction = ReturnType<typeof useMobilePrTitleAction>
