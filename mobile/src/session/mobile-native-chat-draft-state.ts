import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  mergeLandedImagePreviewEchoes,
  migrateImagePreviewMessageIds,
  type LandedImagePreviewEcho
} from './mobile-native-chat-draft-reconcile'
import {
  appendMobileNativeChatPending,
  appendMobileNativeChatPendingToList,
  combineMobileNativeChatPending,
  mergeWaitingSessionPending,
  type MobileNativeChatPendingMessage,
  type MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'
import {
  getMobileNativeChatRuntimeScope,
  getMobileNativeChatRuntimeScopeForToken,
  mobileNativeChatRuntimeTokenFromOrigin,
  writeMobileNativeChatRuntimeScope,
  type MobileNativeChatLaunchDraftSeed,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-owner'

export type { MobileNativeChatLaunchDraftSeed }

const NO_PENDING_MESSAGES: MobileNativeChatPendingMessage[] = []
const NO_IMAGE_PREVIEWS: Record<string, string[]> = {}

function draftScopeFromPendingKey(pendingKey: string): string {
  return pendingKey.split('\0').slice(0, 3).join('\0')
}

export function readMobileNativeChatDraftText(scopeKey: string | null): string {
  return getMobileNativeChatRuntimeScope(scopeKey)?.draftText ?? ''
}

export function readMobileNativeChatDraftEditGeneration(
  token: MobileNativeChatRuntimeScopeToken | null
): number {
  return getMobileNativeChatRuntimeScopeForToken(token)?.draftEditGeneration ?? 0
}

export function updateMobileNativeChatDraftText(
  token: MobileNativeChatRuntimeScopeToken | null,
  value: string | ((current: string) => string)
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    scope.draftEditGeneration += 1
    const next = typeof value === 'function' ? value(scope.draftText) : value
    if (next === scope.draftText) {
      return false
    }
    scope.draftText = next
    return true
  })
}

export function setMobileNativeChatDraftTextIfEmpty(
  token: MobileNativeChatRuntimeScopeToken,
  text: string
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    if (scope.draftText !== '') {
      return false
    }
    scope.draftText = text
    return true
  })
}

export function clearMobileNativeChatDraftTextIfEqual(
  token: MobileNativeChatRuntimeScopeToken,
  text: string
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    if (scope.draftText !== text) {
      return false
    }
    scope.draftText = ''
    return true
  })
}

export function clearMobileNativeChatDraftForSend(
  origin: MobileNativeChatSendOrigin,
  text: string
): void {
  writeMobileNativeChatRuntimeScope(mobileNativeChatRuntimeTokenFromOrigin(origin), (scope) => {
    if (scope.draftEditGeneration !== origin.draftEditGeneration || scope.draftText !== text) {
      return false
    }
    scope.draftText = ''
    return true
  })
}

export function restoreMobileNativeChatRejectedDraft(
  origin: MobileNativeChatSendOrigin,
  text: string
): void {
  writeMobileNativeChatRuntimeScope(mobileNativeChatRuntimeTokenFromOrigin(origin), (scope) => {
    if (scope.draftEditGeneration !== origin.draftEditGeneration || scope.draftText !== '') {
      return false
    }
    scope.draftText = text
    return true
  })
}

export function readMobileNativeChatPending(
  draftKey: string | null,
  pendingKey: string | null
): MobileNativeChatPendingMessage[] {
  const scope = getMobileNativeChatRuntimeScope(draftKey)
  if (!scope || !draftKey) {
    return NO_PENDING_MESSAGES
  }
  const waiting = scope.pendingWaitingForSession
  const session = pendingKey
    ? (scope.pendingBySession[pendingKey] ?? NO_PENDING_MESSAGES)
    : NO_PENDING_MESSAGES
  return combineMobileNativeChatPending(session, waiting)
}

export function moveMobileNativeChatWaitingPendingToSession(
  token: MobileNativeChatRuntimeScopeToken | null,
  pendingKey: string | null
): void {
  if (!token || !pendingKey) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const waiting = scope.pendingWaitingForSession
    if (waiting.length === 0) {
      return false
    }
    scope.pendingBySession = mergeWaitingSessionPending(scope.pendingBySession, pendingKey, waiting)
    scope.pendingWaitingForSession = []
    return true
  })
}

export function appendMobileNativeChatPendingMessage(
  origin: MobileNativeChatSendOrigin,
  text: string,
  images?: string[]
): void {
  if (!origin.pendingKey && !images?.length) {
    return
  }
  writeMobileNativeChatRuntimeScope(mobileNativeChatRuntimeTokenFromOrigin(origin), (scope) => {
    scope.pendingCounter += 1
    const id = `pending-${scope.pendingCounter}`
    if (origin.pendingKey) {
      const next = appendMobileNativeChatPending(
        scope.pendingBySession,
        origin.pendingKey,
        id,
        origin,
        text,
        images
      )
      scope.pendingBySession = next
    } else {
      scope.pendingWaitingForSession = appendMobileNativeChatPendingToList(
        scope.pendingWaitingForSession,
        id,
        origin,
        text,
        images
      )
    }
    return true
  })
}

export function updateMobileNativeChatSessionPending(
  token: MobileNativeChatRuntimeScopeToken | null,
  pendingKey: string | null,
  updater: (current: MobileNativeChatPendingMessage[]) => MobileNativeChatPendingMessage[]
): void {
  if (!pendingKey) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const current = scope.pendingBySession[pendingKey] ?? NO_PENDING_MESSAGES
    const next = updater(current)
    if (next === current) {
      return false
    }
    if (next.length > 0) {
      scope.pendingBySession = { ...scope.pendingBySession, [pendingKey]: next }
      return true
    }
    if (!(pendingKey in scope.pendingBySession)) {
      return false
    }
    const remaining = { ...scope.pendingBySession }
    delete remaining[pendingKey]
    scope.pendingBySession = remaining
    return true
  })
}

export function readMobileNativeChatImagePreviews(
  pendingKey: string | null
): Record<string, string[]> {
  if (!pendingKey) {
    return NO_IMAGE_PREVIEWS
  }
  const draftKey = draftScopeFromPendingKey(pendingKey)
  return (
    getMobileNativeChatRuntimeScope(draftKey)?.imagePreviewsBySession[pendingKey] ??
    NO_IMAGE_PREVIEWS
  )
}

export function migrateMobileNativeChatImagePreviewMessageIds(
  token: MobileNativeChatRuntimeScopeToken | null,
  pendingKey: string | null,
  messages: readonly NativeChatMessage[]
): void {
  if (!pendingKey) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const next = migrateImagePreviewMessageIds(scope.imagePreviewsBySession, pendingKey, messages)
    if (next === scope.imagePreviewsBySession) {
      return false
    }
    scope.imagePreviewsBySession = next
    return true
  })
}

export function mergeMobileNativeChatLandedImagePreviewEchoes(
  token: MobileNativeChatRuntimeScopeToken | null,
  pendingKey: string | null,
  landed: readonly LandedImagePreviewEcho[]
): void {
  if (!pendingKey || landed.length === 0) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const next = mergeLandedImagePreviewEchoes(scope.imagePreviewsBySession, pendingKey, landed)
    if (next === scope.imagePreviewsBySession) {
      return false
    }
    scope.imagePreviewsBySession = next
    return true
  })
}

export function hasMobileNativeChatLaunchDraftSeedRecord(scopeKey: string | null): boolean {
  return getMobileNativeChatRuntimeScope(scopeKey)?.launchDraftSeedRecorded ?? false
}

export function readMobileNativeChatLaunchDraftSeed(
  scopeKey: string | null
): MobileNativeChatLaunchDraftSeed | null {
  const scope = getMobileNativeChatRuntimeScope(scopeKey)
  return scope?.launchDraftSeedRecorded ? scope.launchDraftSeed : null
}

export function setMobileNativeChatLaunchDraftSeed(
  token: MobileNativeChatRuntimeScopeToken,
  seed: MobileNativeChatLaunchDraftSeed | null
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    if (
      scope.launchDraftSeedRecorded &&
      scope.launchDraftSeed?.text === seed?.text &&
      scope.launchDraftSeed?.createdAt === seed?.createdAt
    ) {
      return false
    }
    scope.launchDraftSeedRecorded = true
    scope.launchDraftSeed = seed
    return true
  })
}
