import {
  getMobileNativeChatRuntimeScope,
  getMobileNativeChatRuntimeScopeForToken,
  mobileNativeChatRuntimeTokenFromOrigin,
  publishMobileNativeChatRuntimeScope,
  writeMobileNativeChatRuntimeScope,
  type MobileNativeChatRuntimeScopeToken,
  type MobileNativeChatSendErrorRecord,
  type MobileNativeChatStoredUnconfirmedSend
} from './mobile-native-chat-runtime-owner'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import {
  nextUnconfirmedExpectedOccurrence,
  unconfirmedReservationKey
} from './mobile-native-chat-unconfirmed-send-reservation'

export type { MobileNativeChatSendErrorRecord, MobileNativeChatStoredUnconfirmedSend }

function clearSendErrorTimer(error: MobileNativeChatSendErrorRecord | null): void {
  if (error?.timer) {
    clearTimeout(error.timer)
    error.timer = null
  }
}

export function readMobileNativeChatSendError(
  scopeKey: string | null
): MobileNativeChatSendErrorRecord | null {
  return getMobileNativeChatRuntimeScope(scopeKey)?.sendError ?? null
}

export function recordMobileNativeChatSendError(
  token: MobileNativeChatRuntimeScopeToken | null,
  message: string,
  sourceId: string | null = null
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    if (scope.sendError?.message === message && scope.sendError.sourceId === sourceId) {
      return false
    }
    clearSendErrorTimer(scope.sendError)
    scope.sendErrorCounter += 1
    scope.sendError = {
      id: `send-error-${scope.sendErrorCounter}`,
      message,
      sourceId,
      timer: null
    }
    return true
  })
}

export function clearMobileNativeChatSendError(
  token: MobileNativeChatRuntimeScopeToken | null,
  id?: string
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    if (!scope.sendError || (id && scope.sendError.id !== id)) {
      return false
    }
    clearSendErrorTimer(scope.sendError)
    scope.sendError = null
    return true
  })
}

export function clearMobileNativeChatSendErrorForSource(scopeKey: string, sourceId: string): void {
  const scope = getMobileNativeChatRuntimeScope(scopeKey)
  if (!scope || scope.sendError?.sourceId !== sourceId) {
    return
  }
  clearSendErrorTimer(scope.sendError)
  scope.sendError = null
  publishMobileNativeChatRuntimeScope(scopeKey)
}

export function startMobileNativeChatSendErrorDisplay(
  token: MobileNativeChatRuntimeScopeToken | null,
  errorId: string,
  holdMs: number
): void {
  const scope = getMobileNativeChatRuntimeScopeForToken(token)
  const error = scope?.sendError
  if (!scope || !token || !error || error.id !== errorId || error.timer) {
    return
  }
  error.timer = setTimeout(() => {
    const current = getMobileNativeChatRuntimeScopeForToken(token)
    if (!current?.sendError || current.sendError.id !== errorId) {
      return
    }
    current.sendError.timer = null
    current.sendError = null
    publishMobileNativeChatRuntimeScope(token.scopeKey)
  }, holdMs)
}

export function reserveMobileNativeChatUnconfirmedSend(
  origin: MobileNativeChatSendOrigin
): MobileNativeChatSendOrigin {
  const scope = getMobileNativeChatRuntimeScopeForToken(
    mobileNativeChatRuntimeTokenFromOrigin(origin)
  )
  if (!scope) {
    return origin
  }
  const key = unconfirmedReservationKey(origin)
  const occurrence = nextUnconfirmedExpectedOccurrence(scope, origin)
  const reservations = scope.unconfirmedReservations.get(key) ?? new Set<number>()
  reservations.add(occurrence)
  scope.unconfirmedReservations.set(key, reservations)
  return { ...origin, unconfirmedOccurrence: occurrence }
}

export function releaseMobileNativeChatUnconfirmedSend(origin: MobileNativeChatSendOrigin): void {
  if (origin.unconfirmedOccurrence === undefined) {
    return
  }
  const scope = getMobileNativeChatRuntimeScopeForToken(
    mobileNativeChatRuntimeTokenFromOrigin(origin)
  )
  if (!scope) {
    return
  }
  const key = unconfirmedReservationKey(origin)
  const reservations = scope.unconfirmedReservations.get(key)
  reservations?.delete(origin.unconfirmedOccurrence)
  if (!reservations || reservations.size === 0) {
    scope.unconfirmedReservations.delete(key)
  }
}

export function appendMobileNativeChatUnconfirmedSend(
  origin: MobileNativeChatSendOrigin,
  message: string,
  timeoutMs: number
): void {
  const token = mobileNativeChatRuntimeTokenFromOrigin(origin)
  writeMobileNativeChatRuntimeScope(
    token,
    (scope) => {
      scope.unconfirmedCounter += 1
      const id = `unconfirmed-${scope.unconfirmedCounter}`
      const entry: MobileNativeChatStoredUnconfirmedSend = {
        id,
        sourceId: `unconfirmed:${id}`,
        pendingKey: origin.pendingKey,
        normalizedText: origin.normalizedText,
        expectedOccurrence:
          origin.unconfirmedOccurrence ?? nextUnconfirmedExpectedOccurrence(scope, origin),
        baselineTailMessageId: origin.baselineTailMessageId,
        baselineResolved: origin.baselineResolved,
        message,
        deadlineAt: Date.now() + timeoutMs,
        deadline: null,
        timedOut: false
      }
      entry.deadline = setTimeout(() => {
        const current = getMobileNativeChatRuntimeScopeForToken(token)
        const held = current?.unconfirmedSends.find((candidate) => candidate.id === id)
        if (!current || !held) {
          return
        }
        held.deadline = null
        held.timedOut = true
        publishMobileNativeChatRuntimeScope(token.scopeKey, 'unconfirmed')
      }, timeoutMs)
      scope.unconfirmedSends = [...scope.unconfirmedSends, entry]
      return true
    },
    'unconfirmed'
  )
}

export function readMobileNativeChatUnconfirmedSends(
  scopeKey: string | null
): MobileNativeChatStoredUnconfirmedSend[] {
  return getMobileNativeChatRuntimeScope(scopeKey)?.unconfirmedSends ?? []
}

export function removeMobileNativeChatUnconfirmedSends(
  scopeKey: string,
  entries: readonly MobileNativeChatStoredUnconfirmedSend[]
): void {
  const scope = getMobileNativeChatRuntimeScope(scopeKey)
  if (!scope || entries.length === 0) {
    return
  }
  const removedIds = new Set(entries.map((entry) => entry.id))
  const next = scope.unconfirmedSends.filter((entry) => !removedIds.has(entry.id))
  if (next.length === scope.unconfirmedSends.length) {
    return
  }
  for (const entry of scope.unconfirmedSends) {
    if (removedIds.has(entry.id)) {
      clearTimeout(entry.deadline ?? undefined)
      entry.deadline = null
    }
  }
  scope.unconfirmedSends = next
  publishMobileNativeChatRuntimeScope(scopeKey, 'unconfirmed')
}

export function rebaseMobileNativeChatUnconfirmedSends(
  token: MobileNativeChatRuntimeScopeToken | null,
  entries: readonly MobileNativeChatStoredUnconfirmedSend[],
  baselineTailMessageId: string | null
): void {
  if (entries.length === 0) {
    return
  }
  writeMobileNativeChatRuntimeScope(
    token,
    (scope) => {
      const rebasedIds = new Set(entries.map((entry) => entry.id))
      let changed = false
      for (const entry of scope.unconfirmedSends) {
        if (!rebasedIds.has(entry.id) || entry.baselineResolved) {
          continue
        }
        entry.baselineResolved = true
        entry.baselineTailMessageId = baselineTailMessageId
        changed = true
      }
      return changed
    },
    'unconfirmed'
  )
}

export function markMobileNativeChatExpiredUnconfirmedSendsNotified(
  scopeKey: string,
  entries: readonly MobileNativeChatStoredUnconfirmedSend[]
): void {
  const scope = getMobileNativeChatRuntimeScope(scopeKey)
  if (!scope || entries.length === 0) {
    return
  }
  const expiredIds = new Set(entries.map((entry) => entry.id))
  let changed = false
  for (const entry of scope.unconfirmedSends) {
    if (!expiredIds.has(entry.id)) {
      continue
    }
    if (entry.deadline) {
      clearTimeout(entry.deadline)
      entry.deadline = null
    }
    if (!entry.timedOut) {
      entry.timedOut = true
      changed = true
    }
  }
  if (changed) {
    publishMobileNativeChatRuntimeScope(scopeKey, 'unconfirmed')
  }
}
