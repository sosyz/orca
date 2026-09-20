import type { MutableRefObject } from 'react'
import type { CatalogCommandDelivery } from '../../../src/shared/agent-session-option-catalog'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { MobileNativeChatLaunchDraftSeed } from './use-mobile-native-chat-launch-draft-seed'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'

export type MobileNativeChatMessageSend = {
  /** Composer send that syncs the draft (clear on send, restore on rejection). */
  send: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving variant: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
  /** Answer to an agent question — never touches the composer draft. */
  answerQuestion: (text: string) => Promise<boolean>
  /** Session-option command dispatch (e.g. `/model sonnet`) — never touches the
   *  composer draft; callers need the outcome to track dispatched state. */
  dispatchCommand: (
    text: string,
    options?: { delivery?: CatalogCommandDelivery }
  ) => Promise<MobileNativeChatSendOutcome>
}

export type MobileNativeChatMessageSendArgs = {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  /** Active tab's agent — classification is per-agent (command catalogs differ). */
  agentRef: MutableRefObject<string | null>
  /** Captured when a control send starts so a later tab switch cannot record its
   *  session-option effects against the newly active tab. */
  commandSendRef: MutableRefObject<(command: string) => void>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  /** Launch-context text Orca parked on the agent's TUI input line, or null. Read
   *  at send time so the pre-clear can be sized to every line it occupies. */
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (origin: MobileNativeChatSendOrigin, message: string) => void
  onSendError: (message: string) => void
  streamIdentity?: string
  questionRequestIdentity?: string | null
}
