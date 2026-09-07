import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatRuntimeScope } from './mobile-native-chat-runtime-owner'
import type {
  MobileNativeChatPendingMessage,
  MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'

type UnconfirmedReservationKeySource = {
  pendingKey: string | null
  normalizedText: string
  baselineTailMessageId: string | null
  baselineResolved: boolean
}

type UnconfirmedReservationSource = UnconfirmedReservationKeySource & {
  baselineOccurrences: number
}

export function unconfirmedReservationKey(source: UnconfirmedReservationKeySource): string {
  return `${source.pendingKey ?? ''}\0${source.normalizedText}\0${
    source.baselineTailMessageId ?? ''
  }\0${source.baselineResolved ? '1' : '0'}`
}

function pendingRelativeUnconfirmedOccurrence(
  entry: MobileNativeChatPendingMessage,
  source: UnconfirmedReservationSource
): number | null {
  if (
    entry.baselineResolved !== source.baselineResolved ||
    entry.baselineTailMessageId !== source.baselineTailMessageId ||
    normalizeReconcileText(entry.text) !== source.normalizedText
  ) {
    return null
  }
  if (source.normalizedText === '') {
    return entry.expectedOccurrence
  }
  const relative = entry.expectedOccurrence - source.baselineOccurrences
  return relative > 0 ? relative : null
}

export function nextUnconfirmedExpectedOccurrence(
  scope: Pick<
    MobileNativeChatRuntimeScope,
    'unconfirmedReservations' | 'unconfirmedSends' | 'pendingBySession' | 'pendingWaitingForSession'
  >,
  source: MobileNativeChatSendOrigin
): number {
  const key = unconfirmedReservationKey(source)
  const reservations = scope.unconfirmedReservations.get(key)
  let occurrence = 0
  for (const reserved of reservations ?? []) {
    occurrence = Math.max(occurrence, reserved)
  }
  for (const entry of scope.unconfirmedSends) {
    if (unconfirmedReservationKey(entry) === key) {
      occurrence = Math.max(occurrence, entry.expectedOccurrence)
    }
  }
  for (const entry of source.pendingKey ? (scope.pendingBySession[source.pendingKey] ?? []) : []) {
    const relativeOccurrence = pendingRelativeUnconfirmedOccurrence(entry, source)
    if (relativeOccurrence !== null) {
      occurrence = Math.max(occurrence, relativeOccurrence)
    }
  }
  for (const entry of scope.pendingWaitingForSession) {
    const relativeOccurrence = pendingRelativeUnconfirmedOccurrence(entry, source)
    if (relativeOccurrence !== null) {
      occurrence = Math.max(occurrence, relativeOccurrence)
    }
  }
  return occurrence + 1
}
