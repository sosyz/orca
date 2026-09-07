import {
  clearWatermark,
  forgetHostNotificationSession
} from '../notifications/notification-reconnect-catchup'
import { purgeMobileNativeChatRuntimeScopesForHost } from '../session/mobile-native-chat-runtime-store'
import { removeHost } from './host-store'
import { removeConnectionLogForHost } from './persisted-connection-log-store'

export async function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void
): Promise<void> {
  // Why: closing before the metadata commit can strand a still-paired host on
  // storage failure; closing immediately after success prevents socket leaks.
  await removeHost(hostId)
  purgeMobileNativeChatRuntimeScopesForHost(hostId)
  forgetHostClient(hostId)
  try {
    await removeConnectionLogForHost(hostId)
  } finally {
    // Why: the notification session outlives the socket by design (it must survive
    // reconnects), so removal is the only thing that can retire it. Left behind, a
    // re-pair of the same host would inherit a watermark for a counter it never saw.
    forgetHostNotificationSession(hostId)
    void clearWatermark(hostId)
  }
}
