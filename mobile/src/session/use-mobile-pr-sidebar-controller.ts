import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PRInfo } from '../../../src/shared/github/pull-request-types'
import { githubRepoIdentityKey } from '../../../src/shared/github/repository-identity-key'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchGithubRepoSlug,
  fetchHostedReviewForBranch,
  fetchPRChecks,
  fetchPRForBranch,
  fetchWorkItemDetails
} from './github-pr-rpc'
import {
  loadPrSidebarData,
  loadPrSidebarDetails,
  prSidebarDetailsNeedFetch,
  resolvePrSidebarDetailsAfterPhase2,
  shouldApplyResult,
  shouldSoftRefreshPrSidebarOnHeadChange,
  type PrSidebarLoadDeps,
  type PrSidebarState
} from './mobile-pr-sidebar-state'
import { fetchWorktreeLinkedPR } from '../source-control/mobile-pr-link'

type PrSidebarControllerInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  // branch/headSha come from git.status (not the branchCompare base ref nor worktree metadata, which carries no branch).
  branch: string | null
  headSha: string | null
}

// Load options: the hub chip needs only phase 1 (PR + checks); phase 2 (comments/body) is heavy and waits until the PR segment opens.
export type PrSidebarLoadOptions = {
  includeDetails?: boolean
}

// Identity is worktree + branch only: headSha advances every commit and must not wipe a ready chip to "loading" (soft-refresh handles it).
export function buildMobilePrSidebarIdentity(args: {
  worktreeId: string
  branch: string | null
}): string | null {
  return args.branch ? `${args.worktreeId}\u0000${args.branch}` : null
}

function prDetailsTargetKey(pr: PRInfo): string {
  return JSON.stringify([pr.number, pr.prRepo ? githubRepoIdentityKey(pr.prRepo) : ''])
}

export function useMobilePrSidebarController(input: PrSidebarControllerInput) {
  const { client, connState, worktreeId, branch, headSha } = input
  const identity = buildMobilePrSidebarIdentity({ worktreeId, branch })
  const source = useMemo(() => ({ client, worktreeId, identity }), [client, worktreeId, identity])
  const committedSource = useRef<typeof source | null>(null)
  const [snapshot, setSnapshot] = useState<{ source: typeof source; state: PrSidebarState }>({
    source,
    state: { kind: 'hidden' }
  })
  const state: PrSidebarState = snapshot.source === source ? snapshot.state : { kind: 'hidden' }
  const stateRef = useRef(state)
  stateRef.current = state
  const setState = useCallback(
    (next: PrSidebarState) => {
      if (committedSource.current === source) {
        // Phase two may resolve before React commits the phase-one render.
        stateRef.current = next
        setSnapshot({ source, state: next })
      }
    },
    [source]
  )
  const [probe, setProbe] = useState<{
    client: RpcClient
    worktreeId: string
    isGithubRepo: boolean
  } | null>(null)
  const repoProbeLoaded = probe?.client === client && probe?.worktreeId === worktreeId
  const isGithubRepo = repoProbeLoaded && probe?.isGithubRepo === true
  const [showPRSidebar, setShowPRSidebar] = useState(false)
  const loadSeqRef = useRef(0)
  // Separate seq for phase-2 fetches so they can't cancel a concurrent phase-1 soft refresh (and vice versa).
  const detailsSeqRef = useRef(0)
  // Repository identity prevents equal PR numbers from sharing an in-flight details read.
  const detailsInFlightRef = useRef<{ seq: number; target: string } | null>(null)
  const stateIdentityRef = useRef<string | null>(null)
  const headShaRef = useRef(headSha)

  // Probe is branch-independent (repo eligibility is): requiring a branch would strand a detached-HEAD worktree on a forever spinner.
  const probeReady = client !== null && connState === 'connected'
  useLayoutEffect(() => {
    committedSource.current = source
    loadSeqRef.current += 1
    detailsSeqRef.current += 1
    detailsInFlightRef.current = null
    stateIdentityRef.current = null
    return () => {
      if (committedSource.current === source) {
        committedSource.current = null
      }
    }
  }, [source])

  const buildDeps = useCallback((): PrSidebarLoadDeps | null => {
    if (!client) {
      return null
    }
    return {
      fetchForBranch: (wt, args) => fetchHostedReviewForBranch(client, wt, args),
      fetchWorktreeLinkedPR: (wt) => fetchWorktreeLinkedPR(client, wt),
      fetchPRForBranch: (wt, args) => fetchPRForBranch(client, wt, args),
      fetchWorkItemDetails: (wt, args) => fetchWorkItemDetails(client, wt, args),
      fetchPRChecks: (wt, args) => fetchPRChecks(client, wt, args)
    }
  }, [client])

  useEffect(() => {
    let cancelled = false
    if (!probeReady || !client) {
      return
    }
    void fetchGithubRepoSlug(client, worktreeId)
      .then((outcome) => {
        if (!cancelled) {
          setProbe({ client, worktreeId, isGithubRepo: outcome.ok && outcome.result !== null })
        }
      })
      .catch(() => {
        // Why: sendGithubPrRead normalizes throws, but a stray rejection on unmount must not surface as LogBox.
        if (!cancelled) {
          setProbe({ client, worktreeId, isGithubRepo: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [probeReady, client, worktreeId])

  const load = useCallback(
    async (options?: PrSidebarLoadOptions) => {
      const includeDetails = options?.includeDetails ?? true
      const deps = buildDeps()
      const loadIdentity = identity
      if (committedSource.current !== source || !deps || !branch || !loadIdentity) {
        return
      }
      const seq = loadSeqRef.current + 1
      loadSeqRef.current = seq
      // Don't invalidate in-flight phase 2 here: it's only claimed when this load's own phase 2 starts, so a superseded phase-1 load can't orphan the details fetch.
      const previousIdentity = stateIdentityRef.current
      stateIdentityRef.current = loadIdentity
      // Soft refresh: same-branch ready/none stays visible while checks re-fetch; hard "loading" only on first load or identity wipe.
      const keepVisible =
        previousIdentity === loadIdentity &&
        (stateRef.current.kind === 'ready' ||
          stateRef.current.kind === 'none' ||
          stateRef.current.kind === 'loading')
      if (!keepVisible) {
        setState({ kind: 'loading' })
      }
      // Phase 1: PR + checks (fast); linkedPR read runs in parallel with forBranch so a closed/merged linked PR still resolves.
      const next = await loadPrSidebarData(deps, { worktreeId, branch, headSha })
      if (
        committedSource.current !== source ||
        !shouldApplyResult(seq, loadSeqRef.current) ||
        stateIdentityRef.current !== loadIdentity
      ) {
        return
      }
      stateIdentityRef.current = loadIdentity
      const previousTarget =
        stateRef.current.kind === 'ready' ? prDetailsTargetKey(stateRef.current.data.pr) : null
      const nextTarget = next.kind === 'ready' ? prDetailsTargetKey(next.data.pr) : null
      if (previousTarget !== nextTarget) {
        detailsSeqRef.current += 1
        detailsInFlightRef.current = null
      }

      // Preserve prior details across phase 1 (loadPrSidebarData returns details:null) so soft/PR-tab refresh doesn't blank the comment tree.
      const priorDetails =
        next.kind === 'ready' &&
        stateRef.current.kind === 'ready' &&
        stateRef.current.data.details != null &&
        previousTarget === nextTarget
          ? stateRef.current.data.details
          : null

      if (next.kind === 'ready' && priorDetails != null) {
        setState({ kind: 'ready', data: { ...next.data, details: priorDetails } })
        if (!includeDetails) {
          return
        }
      } else {
        setState(next)
        if (next.kind !== 'ready' || !includeDetails) {
          return
        }
      }

      // Phase 2: refresh (or first-load) the heavy comments/body payload.
      const detailsSeq = detailsSeqRef.current + 1
      detailsSeqRef.current = detailsSeq
      const target = prDetailsTargetKey(next.data.pr)
      detailsInFlightRef.current = { seq: detailsSeq, target }
      const fetchedDetails = await loadPrSidebarDetails(deps, worktreeId, next.data.pr.number)
      // Release the claim unless a newer phase-2 superseded it (never clear theirs).
      if (detailsInFlightRef.current?.seq === detailsSeq) {
        detailsInFlightRef.current = null
      }
      // Ownership keyed on detailsSeq (not loadSeq): a chip-only soft refresh bumps loadSeq without detailsSeq and must not discard these details.
      if (
        committedSource.current !== source ||
        detailsSeq !== detailsSeqRef.current ||
        stateIdentityRef.current !== loadIdentity ||
        stateRef.current.kind !== 'ready' ||
        prDetailsTargetKey(stateRef.current.data.pr) !== target
      ) {
        return
      }
      // Non-fatal null must not leave details===null (UI treats that as forever-loading).
      const details = resolvePrSidebarDetailsAfterPhase2({
        fetched: fetchedDetails,
        prior: stateRef.current.data.details,
        pr: stateRef.current.data.pr
      })
      setState({ kind: 'ready', data: { ...stateRef.current.data, details } })
    },
    [buildDeps, branch, headSha, identity, setState, source, worktreeId]
  )

  // Phase-2-only fill-in; uses detailsSeqRef so it can't cancel a concurrent phase-1, and re-fetches non-null placeholders too.
  const ensurePrSidebarDetails = useCallback(async () => {
    if (committedSource.current !== source) {
      return
    }
    const current = stateRef.current
    if (current.kind !== 'ready' || !prSidebarDetailsNeedFetch(current.data.details)) {
      return
    }
    const deps = buildDeps()
    const loadIdentity = identity
    if (!deps || !loadIdentity || stateIdentityRef.current !== loadIdentity) {
      return
    }
    const prNumber = current.data.pr.number
    const target = prDetailsTargetKey(current.data.pr)
    // Skip if a live phase-2 fetch for this PR already owns the latest details seq (dedupe).
    const inFlight = detailsInFlightRef.current
    if (inFlight && inFlight.target === target && inFlight.seq === detailsSeqRef.current) {
      return
    }
    const detailsSeq = detailsSeqRef.current + 1
    detailsSeqRef.current = detailsSeq
    detailsInFlightRef.current = { seq: detailsSeq, target }
    const fetchedDetails = await loadPrSidebarDetails(deps, worktreeId, prNumber)
    if (detailsInFlightRef.current?.seq === detailsSeq) {
      detailsInFlightRef.current = null
    }
    if (
      committedSource.current !== source ||
      detailsSeq !== detailsSeqRef.current ||
      stateIdentityRef.current !== loadIdentity ||
      stateRef.current.kind !== 'ready' ||
      prDetailsTargetKey(stateRef.current.data.pr) !== target
    ) {
      return
    }
    const details = resolvePrSidebarDetailsAfterPhase2({
      fetched: fetchedDetails,
      prior: stateRef.current.data.details,
      pr: stateRef.current.data.pr
    })
    setState({
      kind: 'ready',
      data: { ...stateRef.current.data, details }
    })
  }, [buildDeps, identity, setState, source, worktreeId])

  // Soft-refresh on same-branch HEAD advance; restart in-flight load so the advance isn't applied with a stale SHA.
  useEffect(() => {
    if (headShaRef.current === headSha) {
      return
    }
    headShaRef.current = headSha
    // Identity just wiped: stateRef still holds stale pre-wipe state, so let the surface's hidden-state effects drive the new load.
    if (stateIdentityRef.current === null) {
      return
    }
    const current = stateRef.current
    if (!shouldSoftRefreshPrSidebarOnHeadChange(current.kind)) {
      return
    }
    void load({
      includeDetails: current.kind === 'ready' && current.data.details != null
    })
  }, [headSha, load])

  const openPRSidebar = useCallback(() => {
    setShowPRSidebar(true)
    // (Re)load on open unless we already have fresh PR data showing.
    if (
      stateIdentityRef.current !== identity ||
      (state.kind !== 'ready' && state.kind !== 'loading')
    ) {
      void load({ includeDetails: true })
    } else if (state.kind === 'ready' && prSidebarDetailsNeedFetch(state.data.details)) {
      // Retries phase-2 placeholders too (failed details load, not only null).
      void ensurePrSidebarDetails()
    }
  }, [identity, state, load, ensurePrSidebarDetails])

  const retry = useCallback(() => {
    void load({ includeDetails: true })
  }, [load])

  return {
    prSidebarState: state,
    prSidebarIsGithubRepo: isGithubRepo,
    prSidebarRepoProbeLoaded: repoProbeLoaded,
    showPRSidebar,
    setShowPRSidebar,
    openPRSidebar,
    retryPRSidebar: retry,
    refetchPRSidebar: load,
    ensurePrSidebarDetails
  }
}

export type MobilePrSidebarController = ReturnType<typeof useMobilePrSidebarController>
