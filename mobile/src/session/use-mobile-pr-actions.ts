import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { githubRepoIdentityKey } from '../../../src/shared/github/repository-identity-key'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchMergePR,
  fetchRemovePRReviewers,
  fetchRequestPRReviewers,
  fetchRerunPRChecks,
  fetchSetPRAutoMerge,
  fetchUpdatePRState
} from './github-pr-mutations'
import type { GitHubPrRepoSlug } from './github-pr-rpc'
import { PrActionsEngine, type PrActionMutations, type PrActionBusyKey } from './pr-actions-engine'

export type { PrActionBusyKey, PrActionMutations } from './pr-actions-engine'

export type PrActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  prNumber: number
  headSha?: string | null
  prRepo?: GitHubPrRepoSlug | null
  refetch: () => void | Promise<void>
  // Test seam: inject fake mutations; defaults to the real github.* wrappers.
  mutations?: PrActionMutations
}

function realMutations(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): PrActionMutations {
  return {
    mergePR: (args) => fetchMergePR(client, worktreeId, args),
    setPRAutoMerge: (args) => fetchSetPRAutoMerge(client, worktreeId, args),
    updatePRState: (args) => fetchUpdatePRState(client, worktreeId, args),
    requestReviewers: (args) => fetchRequestPRReviewers(client, worktreeId, args),
    removeReviewers: (args) => fetchRemovePRReviewers(client, worktreeId, args),
    rerunChecks: (args) => fetchRerunPRChecks(client, worktreeId, args)
  }
}

// Thin React adapter over the pure PrActionsEngine. The engine owns optimistic
// + busy/error/blocked state; the hook just forces re-renders on change and
// keeps the engine's config in sync with props.
export function useMobilePrActions(input: PrActionsInput) {
  const { client, connState, worktreeId, prNumber, headSha, prRepo, refetch } = input
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const repoKey = prRepo ? githubRepoIdentityKey(prRepo) : ''
  const source = useMemo(
    () => ({ client, worktreeId, prNumber, repoKey }),
    [client, worktreeId, prNumber, repoKey]
  )
  const committedSource = useRef<typeof source | null>(null)
  const committedReady = useRef(false)
  const pendingMerges = useRef(new Set<typeof source>())
  const isCurrentSource = useCallback(() => committedSource.current === source, [source])
  const canRun = useCallback(() => isCurrentSource() && committedReady.current, [isCurrentSource])
  const hasPendingMerge = useCallback(
    () =>
      [...pendingMerges.current].some(
        (pending) =>
          pending.client === source.client &&
          pending.worktreeId === source.worktreeId &&
          pending.prNumber === source.prNumber &&
          pending.repoKey === source.repoKey
      ),
    [source]
  )
  const config = useMemo(
    () => ({
      mutations: input.mutations ?? (client ? realMutations(client, worktreeId) : noopMutations()),
      prNumber,
      headSha,
      prRepo,
      refetch: () => (isCurrentSource() ? refetch() : undefined),
      onChange: () => {
        if (isCurrentSource()) {
          forceRender()
        }
      }
    }),
    [input.mutations, client, worktreeId, prNumber, headSha, prRepo, refetch, isCurrentSource]
  )
  // Optimism and in-flight receipts belong to one PR source, including its client.
  const engine = useMemo(() => new PrActionsEngine(config), [source])
  const ready =
    prNumber > 0 &&
    (input.mutations !== undefined || (client !== null && connState === 'connected'))
  useLayoutEffect(() => {
    committedSource.current = source
    committedReady.current = ready
    engine.updateConfig(config)
    return () => {
      if (committedSource.current === source) {
        committedSource.current = null
        committedReady.current = false
      }
    }
  }, [config, engine, ready, source])

  return {
    source,
    isCurrentSource,
    busy: hasPendingMerge() ? { kind: 'merge' as const } : engine.busy,
    isBusy: useCallback(
      (key: PrActionBusyKey) => (key.kind === 'merge' ? hasPendingMerge() : engine.isBusy(key)),
      [engine, hasPendingMerge]
    ),
    error: engine.error,
    blocked: engine.blocked,
    clearError: useCallback(() => {
      if (isCurrentSource()) {
        engine.clearError()
      }
    }, [engine, isCurrentSource]),
    clearBlocked: useCallback(() => {
      if (isCurrentSource()) {
        engine.clearBlocked()
      }
    }, [engine, isCurrentSource]),
    merge: useCallback(
      (method?: Parameters<PrActionsEngine['merge']>[0]) => {
        if (!canRun() || hasPendingMerge()) {
          return
        }
        // A pending merge survives switching away and back to the same PR.
        pendingMerges.current.add(source)
        forceRender()
        void engine.merge(method).finally(() => {
          pendingMerges.current.delete(source)
          if (committedSource.current) {
            forceRender()
          }
        })
      },
      [canRun, engine, hasPendingMerge, source]
    ),
    setAutoMerge: useCallback(
      (enabled: boolean, method?: Parameters<PrActionsEngine['setAutoMerge']>[1]) => {
        if (canRun()) {
          void engine.setAutoMerge(enabled, method)
        }
      },
      [engine, canRun]
    ),
    updateState: useCallback(
      (state: 'open' | 'closed') => {
        if (canRun()) {
          void engine.updateState(state)
        }
      },
      [engine, canRun]
    ),
    requestReviewer: useCallback(
      (login: string) => {
        if (canRun()) {
          void engine.requestReviewer(login)
        }
      },
      [engine, canRun]
    ),
    removeReviewer: useCallback(
      (login: string) => {
        if (canRun()) {
          void engine.removeReviewer(login)
        }
      },
      [engine, canRun]
    ),
    rerunFailingChecks: useCallback(() => {
      if (canRun()) {
        void engine.rerunFailingChecks()
      }
    }, [engine, canRun]),
    resolveAutoMerge: useCallback(
      (authoritative: boolean) => engine.resolveAutoMerge(authoritative),
      [engine]
    ),
    resolveState: useCallback(
      (authoritative: Parameters<PrActionsEngine['resolveState']>[0]) =>
        engine.resolveState(authoritative),
      [engine]
    ),
    resolveReviewerRequested: useCallback(
      (login: string, authoritative: boolean) =>
        engine.resolveReviewerRequested(login, authoritative),
      [engine]
    )
  }
}

// Stand-in mutations used before a client exists; they never fire (the hook gates
// on `ready`) but keep the engine constructable.
function noopMutations(): PrActionMutations {
  const fail = async () => ({ ok: false as const, error: 'Not connected' })
  return {
    mergePR: fail,
    setPRAutoMerge: fail,
    updatePRState: fail,
    requestReviewers: fail,
    removeReviewers: fail,
    rerunChecks: fail
  }
}

export type MobilePrActions = ReturnType<typeof useMobilePrActions>
