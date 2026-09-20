import { useCallback, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { sendMobileNativeChatMessageWithOutcome } from './mobile-native-chat-send'
import { useMobileNativeChatCardRequestOwner } from './use-mobile-native-chat-card-request-owner'

/** Sends the Escape that dismisses an ask/question card. Its own module for the
 *  same reason stop/permission/answer are: the controller owns composition, not
 *  the per-action write semantics. */
export function useMobileNativeChatCancelAsk(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  streamIdentity: string
  requestIdentity?: string | null
  /** Drops any in-flight paced answer writes before the Escape lands. */
  cancelPending: () => void
  onSendError: (message: string) => void
}): () => Promise<boolean> {
  const { client, enabled, handleRef, deviceTokenRef, cancelPending, onSendError } = args
  const { isCurrent, canSend } = useMobileNativeChatCardRequestOwner(args)
  return useCallback(async (): Promise<boolean> => {
    const handle = handleRef.current
    if (!isCurrent(handle) || !canSend(handle, true)) {
      return false
    }
    if (!client || !handle || !enabled) {
      onSendError('Cancel not sent (disconnected)')
      return false
    }
    cancelPending()
    // Escape never submits the composer, so no stale-input heal: it would consume
    // the marker still protecting the next real message.
    const outcome = await sendMobileNativeChatMessageWithOutcome({
      client,
      terminal: handle,
      text: String.fromCharCode(27),
      enter: false,
      ...(deviceTokenRef.current
        ? { mobileClient: { id: deviceTokenRef.current, type: 'mobile' } }
        : {})
    })
    if (!isCurrent(handle)) {
      return false
    }
    if (outcome === 'unknown') {
      // Why: the Escape may have landed (ack lost / path cutover) — a definite
      // "not sent" would invite a second Escape into a changed prompt state.
      onSendError('Cancel unconfirmed — check chat before retrying')
    } else if (outcome === 'rejected') {
      onSendError('Cancel not sent')
    }
    return outcome === 'accepted'
  }, [
    args.requestIdentity,
    cancelPending,
    client,
    deviceTokenRef,
    enabled,
    handleRef,
    canSend,
    isCurrent,
    onSendError
  ])
}
