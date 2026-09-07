import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countUserTextOccurrences,
  findLandedImagePreviewEchoes,
  findLandedUnconfirmedSends,
  normalizeReconcileText
} from './mobile-native-chat-draft-reconcile'
import { rebaseMobileNativeChatPendingBaselines } from './mobile-native-chat-pending-baseline'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type {
  MobileNativeChatPendingMessage,
  MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'
import {
  appendMobileNativeChatPendingMessage,
  appendMobileNativeChatUnconfirmedSend,
  clearMobileNativeChatDraftForSend,
  clearMobileNativeChatSendErrorForSource,
  markMobileNativeChatExpiredUnconfirmedSendsNotified,
  mergeMobileNativeChatLandedImagePreviewEchoes,
  migrateMobileNativeChatImagePreviewMessageIds,
  moveMobileNativeChatWaitingPendingToSession,
  readMobileNativeChatDraftText,
  readMobileNativeChatDraftEditGeneration,
  readMobileNativeChatImagePreviews,
  readMobileNativeChatPending,
  readMobileNativeChatUnconfirmedSends,
  rebaseMobileNativeChatUnconfirmedSends,
  recordMobileNativeChatSendError,
  removeMobileNativeChatUnconfirmedSends,
  restoreMobileNativeChatRejectedDraft,
  updateMobileNativeChatDraftText,
  updateMobileNativeChatSessionPending,
  useMobileNativeChatUnconfirmedRevision,
  useMobileNativeChatRuntimeScopeToken,
  type MobileNativeChatLaunchDraftSeed
} from './mobile-native-chat-runtime-store'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { useMobileNativeChatLaunchDraftSeed } from './use-mobile-native-chat-launch-draft-seed'

export type { MobileNativeChatPendingMessage, MobileNativeChatSendOrigin }
export type { MobileNativeChatLaunchDraftSeed }

// Ack-lost sends wait for a transcript echo before surfacing as unconfirmed.
const UNCONFIRMED_SEND_DEADLINE_MS = 20_000

export function useMobileNativeChatDrafts(args: {
  hostId: string
  worktreeId: string
  tabId: string | null
  sessionId: string | null
  messages: readonly NativeChatMessage[]
  /** Host-provided launch context still parked as an unsent TUI-input draft. */
  launchDraft?: string | null
  launchDraftCreatedAt?: number | null
  /** Whether the tab is currently resolved to the chat view. Off-chat the
   *  launch-draft effects hold their state instead of acting on it. */
  chatActive?: boolean
  /** `messages` is not yet this session's real history (read in flight, or the
   *  transcript still belongs to the previously active tab), so it cannot be
   *  trusted to decline or retire the seed. */
  transcriptLoading?: boolean
  /** `messages` is this session's own settled history — so an empty one really
   *  is an empty conversation, not a read that failed or never ran. Only then
   *  does a send's captured tail describe a real boundary. */
  transcriptSettled: boolean
}): {
  composerText: string
  setComposerText: Dispatch<SetStateAction<string>>
  getComposerEditGeneration: () => number
  pending: MobileNativeChatPendingMessage[]
  /** Phone-local previews rebound to the transcript message that replaced the
   *  optimistic echo, keyed by authoritative message id. */
  imagePreviewsByMessageId: Record<string, string[]>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  /** Launch-context text still believed to be parked on the agent's TUI input
   *  line, or null once it has been declined or retired. Send paths size their
   *  pre-clear from it, since one Ctrl+U clears only one logical line. */
  readSeededLaunchDraft: () => string | null
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
  /** Clear the composer at send time, before the RPC settles. */
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  /** Put the text back after a definite rejection, unless newer edits exist. */
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (origin: MobileNativeChatSendOrigin, message: string) => void
} {
  const {
    hostId,
    worktreeId,
    tabId,
    sessionId,
    messages,
    launchDraft,
    launchDraftCreatedAt,
    chatActive = true,
    transcriptLoading,
    transcriptSettled
  } = args
  const draftKey = mobileNativeChatScopeKey(hostId, worktreeId, tabId)
  const pendingKey = draftKey && sessionId ? `${draftKey}\0${sessionId}` : null
  const scopeToken = useMobileNativeChatRuntimeScopeToken(draftKey)
  const unconfirmedRevision = useMobileNativeChatUnconfirmedRevision(draftKey)
  const composerEditGenerationRef = useRef(0)
  const getComposerEditGeneration = useCallback(() => composerEditGenerationRef.current, [])
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const { readSeededLaunchDraft, readSeededLaunchDraftSeed } = useMobileNativeChatLaunchDraftSeed({
    draftKey,
    scopeToken,
    messages,
    launchDraft,
    launchDraftCreatedAt,
    chatActive,
    transcriptLoading
  })

  const setComposerText: Dispatch<SetStateAction<string>> = useCallback(
    (value) => {
      if (!scopeToken) {
        return
      }
      composerEditGenerationRef.current += 1
      updateMobileNativeChatDraftText(scopeToken, value)
    },
    [scopeToken]
  )

  const captureSendOrigin = useCallback(
    (text: string) => {
      if (!draftKey || !scopeToken) {
        return null
      }
      const normalizedText = normalizeReconcileText(text)
      return {
        draftKey,
        draftEditGeneration: readMobileNativeChatDraftEditGeneration(scopeToken),
        pendingKey,
        scopeGeneration: scopeToken.generation,
        normalizedText,
        baselineOccurrences: countUserTextOccurrences(messagesRef.current, normalizedText),
        baselineTailMessageId: messagesRef.current.at(-1)?.id ?? null,
        // Only a settled read makes this a boundary. Anything else — hydrating,
        // or a read that failed — hands back an empty list that reads as "the
        // conversation was empty", which lets any row claim this send later.
        baselineResolved: transcriptSettled
      }
    },
    [draftKey, pendingKey, scopeToken, transcriptSettled]
  )

  // Why: over relay the send RPC can take seconds (or lose only its ack), and a
  // composer that waits for settlement to empty reads as "my prompt didn't
  // send". Clear at send time; a definite rejection restores the text below.
  const clearDraftForSend = useCallback(
    (origin: MobileNativeChatSendOrigin, text: string) =>
      clearMobileNativeChatDraftForSend(origin, text),
    []
  )

  const restoreRejectedDraft = useCallback(
    (origin: MobileNativeChatSendOrigin, text: string) =>
      restoreMobileNativeChatRejectedDraft(origin, text),
    []
  )

  const acceptSend = useCallback(
    (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => {
      appendMobileNativeChatPendingMessage(origin, text, images)
    },
    []
  )

  // Why: a relay drop mid-send loses only the ack in the common case — the
  // desktop already delivered the message. Hold the send instead of claiming
  // failure (which baits a duplicate): stay quiet when the transcript echo
  // lands, and surface the uncertainty if the deadline passes without one.
  // The composer was already cleared at send time, so this never touches drafts.
  const holdUnconfirmedSend = useCallback(
    (origin: MobileNativeChatSendOrigin, message: string) =>
      appendMobileNativeChatUnconfirmedSend(origin, message, UNCONFIRMED_SEND_DEADLINE_MS),
    []
  )

  useEffect(() => {
    if (!draftKey) {
      return
    }
    const relevant = readMobileNativeChatUnconfirmedSends(draftKey)
    if (relevant.length === 0) {
      return
    }
    let remaining = relevant
    const currentSessionEntries = relevant.filter(
      (entry) => entry.pendingKey === null || entry.pendingKey === pendingKey
    )
    if (transcriptSettled) {
      const resolved = currentSessionEntries.filter((entry) => entry.baselineResolved)
      const landed = findLandedUnconfirmedSends(messages, resolved)
      if (landed.length > 0) {
        const landedSet = new Set(landed)
        removeMobileNativeChatUnconfirmedSends(draftKey, landed)
        for (const entry of landed) {
          clearMobileNativeChatSendErrorForSource(draftKey, entry.sourceId)
        }
        remaining = relevant.filter((entry) => !landedSet.has(entry))
      }
      const unresolved = currentSessionEntries.filter(
        (entry) => !entry.baselineResolved && remaining.includes(entry)
      )
      if (unresolved.length > 0) {
        rebaseMobileNativeChatUnconfirmedSends(scopeToken, unresolved, messages.at(-1)?.id ?? null)
      }
    }
    const expired = remaining.filter((entry) => entry.timedOut || entry.deadlineAt <= Date.now())
    if (expired.length === 0) {
      return
    }
    markMobileNativeChatExpiredUnconfirmedSendsNotified(draftKey, expired)
    for (const entry of expired) {
      recordMobileNativeChatSendError(scopeToken, entry.message, entry.sourceId)
    }
  }, [draftKey, messages, pendingKey, scopeToken, transcriptSettled, unconfirmedRevision])

  const pending = readMobileNativeChatPending(draftKey, pendingKey)
  useEffect(() => {
    moveMobileNativeChatWaitingPendingToSession(scopeToken, pendingKey)
  }, [pending.length, pendingKey, scopeToken])

  useEffect(() => {
    if (!pendingKey) {
      return
    }
    migrateMobileNativeChatImagePreviewMessageIds(scopeToken, pendingKey, messages)
    if (pending.length === 0) {
      return
    }
    // Only judge a send against a read known to be this session's. Note this
    // does NOT give an image echo a boundary — the rebase deliberately leaves
    // those on whatever they captured — so a caption-less photo sent before any
    // read settled can still claim an older photo turn, exactly as it does on
    // main. Fixing that needs a tail that excludes older image turns without
    // excluding the send's own echo, which is a separate change.
    const landedImagePreviews = findLandedImagePreviewEchoes(
      messages,
      pending.filter((item) => item.baselineResolved)
    )
    const landedImagePendingIds = new Set(landedImagePreviews.map((preview) => preview.pendingId))
    if (landedImagePreviews.length > 0) {
      mergeMobileNativeChatLandedImagePreviewEchoes(scopeToken, pendingKey, landedImagePreviews)
    }
    updateMobileNativeChatSessionPending(scopeToken, pendingKey, (current) => {
      // Rebase before retiring: a send captured before the history was known has
      // to own a real boundary before any row can be judged against it.
      const rebased = transcriptSettled
        ? rebaseMobileNativeChatPendingBaselines(messages, current)
        : current
      return retireLandedMobileNativeChatPending(messages, rebased, landedImagePendingIds)
    })
  }, [messages, pending, pendingKey, scopeToken, transcriptSettled])

  return {
    composerText: readMobileNativeChatDraftText(draftKey),
    setComposerText,
    getComposerEditGeneration,
    pending,
    imagePreviewsByMessageId: pendingKey
      ? readMobileNativeChatImagePreviews(pendingKey)
      : readMobileNativeChatImagePreviews(null),
    captureSendOrigin,
    readSeededLaunchDraft,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend
  }
}
