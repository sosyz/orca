import {
  appendPendingNativeChatImages,
  type PendingNativeChatImage
} from './mobile-native-chat-image-attachment'
import {
  getMobileNativeChatRuntimeAttachmentCounter,
  getMobileNativeChatRuntimeScope,
  writeMobileNativeChatRuntimeScope,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-owner'

const NO_ATTACHMENTS: PendingNativeChatImage[] = []

export function readMobileNativeChatAttachments(scopeKey: string | null): PendingNativeChatImage[] {
  return getMobileNativeChatRuntimeScope(scopeKey)?.attachments ?? NO_ATTACHMENTS
}

export function readMobileNativeChatIsAttaching(scopeKey: string | null): boolean {
  return (getMobileNativeChatRuntimeScope(scopeKey)?.attachingCount ?? 0) > 0
}

export function beginMobileNativeChatImageAttach(
  token: MobileNativeChatRuntimeScopeToken | null
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    scope.attachingCount += 1
    return true
  })
}

export function endMobileNativeChatImageAttach(
  token: MobileNativeChatRuntimeScopeToken | null
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const next = Math.max(0, scope.attachingCount - 1)
    if (next === scope.attachingCount) {
      return false
    }
    scope.attachingCount = next
    return true
  })
}

export function appendMobileNativeChatAttachments(
  token: MobileNativeChatRuntimeScopeToken | null,
  uploaded: readonly Omit<PendingNativeChatImage, 'id'>[]
): void {
  if (uploaded.length === 0) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    scope.attachments = appendPendingNativeChatImages(
      scope.attachments,
      uploaded,
      getMobileNativeChatRuntimeAttachmentCounter()
    )
    return true
  })
}

export function removeMobileNativeChatAttachment(
  token: MobileNativeChatRuntimeScopeToken | null,
  id: string
): void {
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const next = scope.attachments.filter((attachment) => attachment.id !== id)
    if (next.length === scope.attachments.length) {
      return false
    }
    scope.attachments = next
    return true
  })
}

export function removeSentMobileNativeChatAttachments(
  token: MobileNativeChatRuntimeScopeToken | null,
  sentIds: ReadonlySet<string>
): void {
  if (sentIds.size === 0) {
    return
  }
  writeMobileNativeChatRuntimeScope(token, (scope) => {
    const next = scope.attachments.filter((attachment) => !sentIds.has(attachment.id))
    if (next.length === scope.attachments.length) {
      return false
    }
    scope.attachments = next
    return true
  })
}
