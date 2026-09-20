import type { RpcClient } from '../transport/rpc-client'
import {
  getMobileNativeChatRuntimeScopeForToken,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'

export function createNativeChatImageUploadOwner(
  token: MobileNativeChatRuntimeScopeToken,
  client: RpcClient,
  getConnectionId: () => Promise<string | null>
): {
  isCurrent: () => boolean
  assertCurrent: () => void
  client: Pick<RpcClient, 'sendRequest'>
  getConnectionId: () => Promise<string | null>
} {
  const isCurrent = () => getMobileNativeChatRuntimeScopeForToken(token) !== null
  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new Error('Attachment scope retired')
    }
  }
  return {
    isCurrent,
    assertCurrent,
    client: {
      sendRequest: (method, params, options) => {
        // An already-created upload session may still need its best-effort abort.
        if (method !== 'clipboard.abortImageUpload') {
          assertCurrent()
        }
        return client.sendRequest(method, params, options)
      }
    },
    getConnectionId: async () => {
      assertCurrent()
      const connectionId = await getConnectionId()
      assertCurrent()
      return connectionId
    }
  }
}
