import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'

export type MobileNativeChatPendingMessage = {
  id: string
  text: string
  expectedOccurrence: number
  /** Local preview URIs carried by the send for its optimistic echo. */
  images?: string[]
  baselineTailMessageId: string | null
  /** Whether the transcript this baseline was captured from was already this
   *  session's own history. A send issued mid-hydration is captured unresolved
   *  and rebased onto the first authoritative read instead of reconciling
   *  against rows that may belong to another tab. */
  baselineResolved: boolean
}

export type MobileNativeChatSendOrigin = {
  draftKey: string
  draftEditGeneration: number
  pendingKey: string | null
  scopeGeneration: number
  normalizedText: string
  baselineOccurrences: number
  baselineTailMessageId: string | null
  baselineResolved: boolean
  /** 1-based send ordinal after this baseline for the same text/image key. */
  unconfirmedOccurrence?: number
}

type PendingByKey = Record<string, MobileNativeChatPendingMessage[]>

export function combineMobileNativeChatPending(
  session: MobileNativeChatPendingMessage[],
  waiting: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  if (waiting.length === 0) {
    return session
  }
  const sessionIds = new Set(session.map((item) => item.id))
  return [...session, ...waiting.filter((item) => !sessionIds.has(item.id))]
}

export function appendMobileNativeChatPending(
  previous: PendingByKey,
  key: string,
  id: string,
  origin: MobileNativeChatSendOrigin,
  text: string,
  images?: string[]
): PendingByKey {
  const current = previous[key] ?? []
  return {
    ...previous,
    [key]: appendMobileNativeChatPendingToList(current, id, origin, text, images)
  }
}

export function appendMobileNativeChatPendingToList(
  current: MobileNativeChatPendingMessage[],
  id: string,
  origin: MobileNativeChatSendOrigin,
  text: string,
  images?: string[]
): MobileNativeChatPendingMessage[] {
  // Image ordinal selection and counting must share the empty-text discriminator.
  const expectedImageEchoOrdinal =
    current.filter(
      (pending) => normalizeReconcileText(pending.text) === '' && pending.images?.length
    ).length + 1
  const relativeOccurrence =
    origin.unconfirmedOccurrence ??
    current.filter(
      (pending) =>
        normalizeReconcileText(pending.text) === origin.normalizedText &&
        pending.expectedOccurrence > origin.baselineOccurrences
    ).length + 1
  return [
    ...current,
    {
      id,
      text,
      expectedOccurrence:
        origin.normalizedText === ''
          ? (origin.unconfirmedOccurrence ?? expectedImageEchoOrdinal)
          : origin.baselineOccurrences + relativeOccurrence,
      baselineTailMessageId: origin.baselineTailMessageId,
      baselineResolved: origin.baselineResolved,
      ...(images?.length ? { images } : {})
    }
  ]
}

export function mergeWaitingSessionPending(
  previous: PendingByKey,
  sessionKey: string,
  waiting: readonly MobileNativeChatPendingMessage[]
): PendingByKey {
  const current = previous[sessionKey] ?? []
  const currentIds = new Set(current.map((item) => item.id))
  const moved = waiting.filter((item) => !currentIds.has(item.id))
  return moved.length > 0 ? { ...previous, [sessionKey]: [...current, ...moved] } : previous
}
