import type { MobileNativeChatRuntimeScope } from './mobile-native-chat-runtime-owner'

function evictionPriority(scope: MobileNativeChatRuntimeScope): number {
  if (
    scope.draftText.length > 0 ||
    scope.attachments.length > 0 ||
    scope.attachingCount > 0 ||
    scope.pendingWaitingForSession.length > 0 ||
    Object.values(scope.pendingBySession).some((pending) => pending.length > 0) ||
    scope.unconfirmedSends.length > 0 ||
    [...scope.unconfirmedReservations.values()].some((reservations) => reservations.size > 0) ||
    scope.sendError !== null ||
    scope.launchDraftSeed !== null
  ) {
    return 2
  }
  return scope.launchDraftSeedRecorded ? 1 : 0
}

export function findMobileNativeChatEvictionCandidate(
  scopes: ReadonlyMap<string, MobileNativeChatRuntimeScope>,
  protectedScopeKey?: string
): string | null {
  let candidate: string | null = null
  let candidatePriority = Infinity
  for (const [scopeKey, scope] of scopes) {
    if (scopeKey === protectedScopeKey || scope.activeCount > 0) {
      continue
    }
    const priority = evictionPriority(scope)
    if (priority >= candidatePriority) {
      continue
    }
    candidate = scopeKey
    candidatePriority = priority
    if (priority === 0) {
      break
    }
  }
  return candidate
}
