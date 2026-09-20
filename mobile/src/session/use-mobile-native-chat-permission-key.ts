import { useState } from 'react'
import {
  advanceNativeChatPromptIdentity,
  nativeChatPromptIdentityKey
} from '../../../src/shared/native-chat-prompt-identity'
import type { MobileChatPermission } from './mobile-native-chat-permission'

export function usePermissionCardKey(
  scopeKey: string | undefined,
  permission: MobileChatPermission | null | undefined,
  requestKey: string | undefined
): string | null {
  const scope = JSON.stringify([scopeKey, permission])
  const [identity, setIdentity] = useState(() =>
    advanceNativeChatPromptIdentity(null, scope, requestKey)
  )
  const next = advanceNativeChatPromptIdentity(identity, scope, requestKey)
  if (next !== identity) {
    setIdentity(next)
  }
  return nativeChatPromptIdentityKey(identity)
}
