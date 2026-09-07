import { useCallback, useEffect } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizedUserText } from './mobile-native-chat-draft-reconcile'
import {
  clearMobileNativeChatDraftTextIfEqual,
  hasMobileNativeChatLaunchDraftSeedRecord,
  readMobileNativeChatLaunchDraftSeed,
  setMobileNativeChatDraftTextIfEmpty,
  setMobileNativeChatLaunchDraftSeed,
  type MobileNativeChatLaunchDraftSeed,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'

export type { MobileNativeChatLaunchDraftSeed }

/**
 * Adopting the host's launch-context prefill as the mobile composer draft, and
 * retiring it again once it is resolved elsewhere. Split out of the drafts hook
 * so the general draft/pending accounting stays separate from this one concern.
 */
export function useMobileNativeChatLaunchDraftSeed(args: {
  draftKey: string | null
  scopeToken: MobileNativeChatRuntimeScopeToken | null
  messages: readonly NativeChatMessage[]
  /** Host-provided launch context still parked as an unsent TUI-input draft. */
  launchDraft?: string | null
  launchDraftCreatedAt?: number | null
  chatActive: boolean
  transcriptLoading?: boolean
}): {
  /** Text still believed to be parked on the agent's TUI input line, or null
   *  once declined or retired. Send paths size their pre-clear from it, since
   *  one Ctrl+U clears only one logical line. */
  readSeededLaunchDraft: () => string | null
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
} {
  const {
    draftKey,
    scopeToken,
    messages,
    launchDraft,
    launchDraftCreatedAt,
    chatActive,
    transcriptLoading
  } = args

  // Why: launch context delivered as a TUI-input prefill is invisible in chat;
  // adopt it once as the composer draft so mobile shows the same context.
  useEffect(() => {
    if (
      !draftKey ||
      !scopeToken ||
      !chatActive ||
      !launchDraft?.trim() ||
      hasMobileNativeChatLaunchDraftSeedRecord(draftKey)
    ) {
      return
    }
    // Why: `session.tabs` carries launchDraft before the transcript read settles,
    // and an empty (or previous tab's) list would let the decline below misjudge
    // an already-submitted prefill — long enough for a send to duplicate it.
    if (transcriptLoading) {
      return
    }
    // A user turn already in the transcript means the TUI prefill was submitted
    // or deliberately cleared; decline instead of resurrecting it.
    if (messages.some((message) => normalizedUserText(message) !== null)) {
      setMobileNativeChatLaunchDraftSeed(scopeToken, null)
      return
    }
    setMobileNativeChatLaunchDraftSeed(scopeToken, {
      text: launchDraft,
      createdAt: launchDraftCreatedAt ?? null
    })
    setMobileNativeChatDraftTextIfEmpty(scopeToken, launchDraft)
  }, [
    chatActive,
    draftKey,
    launchDraft,
    launchDraftCreatedAt,
    messages,
    scopeToken,
    transcriptLoading
  ])

  // Drop an untouched adopted copy once the prefill is resolved elsewhere — a
  // user turn landed (sent or cleared TUI-side) or the host stopped publishing
  // it (desktop sent or reconciled it). User edits are always kept.
  useEffect(() => {
    // Same gates as the seed: off-chat there is no retraction to read (the tab
    // publishes no draft to us), and an untrusted transcript would wipe an
    // untouched copy on the strength of another tab's user turns.
    if (!draftKey || !scopeToken || !chatActive || transcriptLoading) {
      return
    }
    const seeded = readMobileNativeChatLaunchDraftSeed(draftKey)
    if (!seeded) {
      return
    }
    const hasUserTurn = messages.some((message) => normalizedUserText(message) !== null)
    if (!hasUserTurn && launchDraft?.trim()) {
      return
    }
    setMobileNativeChatLaunchDraftSeed(scopeToken, null)
    clearMobileNativeChatDraftTextIfEqual(scopeToken, seeded.text)
  }, [chatActive, draftKey, launchDraft, messages, scopeToken, transcriptLoading])

  // A missing or declined entry means there is nothing of ours on the TUI line.
  const readSeededLaunchDraft = useCallback(
    () => readMobileNativeChatLaunchDraftSeed(draftKey)?.text ?? null,
    [draftKey]
  )
  const readSeededLaunchDraftSeed = useCallback(
    () => readMobileNativeChatLaunchDraftSeed(draftKey),
    [draftKey]
  )

  return { readSeededLaunchDraft, readSeededLaunchDraftSeed }
}
