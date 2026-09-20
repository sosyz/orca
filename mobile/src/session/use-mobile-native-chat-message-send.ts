import { useCallback } from 'react'
import type {
  MobileNativeChatMessageSend,
  MobileNativeChatMessageSendArgs
} from './mobile-native-chat-message-send-contract'
import {
  clearMobileNativeChatInput,
  openMobileNativeChatSendBudget,
  sendMobileNativeChatMessageWithOutcome,
  typeMobileNativeChatCommandWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import type { CatalogCommandDelivery } from '../../../src/shared/agent-session-option-catalog'
import { isSlashCommandDraft } from '../../../src/shared/native-chat-slash-commands'
import { buildNativeChatPasteBytes } from '../../../src/shared/native-chat-send'
import { sanitizeBracketedPasteText } from '../../../src/shared/terminal-paste-text'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'
import { useMobileNativeChatCardRequestOwner } from './use-mobile-native-chat-card-request-owner'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'
import {
  acquireMobileNativeChatTerminalWrite,
  captureMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import {
  AGENT_TUI_CLEAR_INPUT_LINE,
  buildAgentTuiClearInputForText
} from '../../../src/shared/agent-tui-input-clear'
import {
  releaseMobileNativeChatUnconfirmedSend,
  reserveMobileNativeChatUnconfirmedSend
} from './mobile-native-chat-runtime-store'

export type { MobileNativeChatMessageSend } from './mobile-native-chat-message-send-contract'

/** The native-chat send seam: one write path shared by composer sends, image
 *  sends, and question answers, wired to the drafts accounting. */
export function useMobileNativeChatMessageSend(
  args: MobileNativeChatMessageSendArgs
): MobileNativeChatMessageSend {
  const {
    client,
    enabled,
    handleRef,
    deviceTokenRef,
    agentRef,
    commandSendRef,
    captureSendOrigin,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend,
    onSendError
  } = args
  const { isCurrent: isCurrentQuestion, canSend: canSendQuestion } =
    useMobileNativeChatCardRequestOwner({
      client,
      enabled,
      handleRef,
      streamIdentity: args.streamIdentity ?? '',
      requestIdentity: args.questionRequestIdentity
    })

  const sendMessage = useCallback(
    async (
      draftText: string,
      images: string[] | undefined,
      syncComposer: boolean,
      recordControlSend: boolean,
      operation?: {
        deadline?: number
        isCurrent?: () => boolean
        canContinue?: () => boolean
      }
    ): Promise<MobileNativeChatSendOutcome> => {
      if (operation?.canContinue?.() === false) {
        return 'rejected'
      }
      // The host writes trailing whitespace verbatim onto the agent's input line,
      // where it can glue the next rapid send onto this one (#14262). Only the
      // bytes that go out are trimmed: `draftText` is what the user typed, and a
      // rejected send has to put back exactly that (#14819).
      // Echo matching must see the same printable ESC substitute as the terminal.
      const text = sanitizeBracketedPasteText(draftText.trimEnd())
      const handle = handleRef.current
      const origin = captureSendOrigin(text)
      const agent = agentRef.current
      const recordCommand = commandSendRef.current
      // Why: the lease collapses one render after `connState`, so a question-card
      // answer (which reaches this send directly) would otherwise burn the whole
      // 15s heal+send budget waiting on a socket that is already gone.
      if (!client || !handle || !origin || !enabled) {
        onSendError('Message not sent (disconnected)')
        return 'rejected'
      }
      const classification = classifyMobileNativeChatSend(agent, text)
      const owner = captureMobileNativeChatTerminalWrite(handle)
      const chatOrigin =
        classification === 'chat' ? reserveMobileNativeChatUnconfirmedSend(origin) : origin
      try {
        // The agent's input may still hold an orphaned image paste from an earlier
        // send (#10228); submitting on top of it would glue the image onto this
        // message. Healed before the draft clear so a failed heal — which sends
        // nothing — leaves the composer exactly as the user left it.
        // One budget for the whole action: a hung heal must eat into the text send's
        // time, not hand it a fresh timeout and pin the composer for twice as long.
        // An image send already opened one covering its paste — keep spending that.
        const deadline = operation?.deadline ?? openMobileNativeChatSendBudget()
        const healArgs = {
          client,
          terminal: handle,
          deviceToken: deviceTokenRef.current,
          deadline
        }
        const healed = await healMobileNativeChatStaleInput(healArgs)
        if (owner?.cancelled || operation?.canContinue?.() === false) {
          return 'rejected'
        }
        if (!healed) {
          onSendError('Message not sent')
          return 'rejected'
        }
        // Why: empty the composer at send time, not on the ack — over relay the
        // round trip is visible, and a lost ack must not strand the sent prompt
        // in the box. Only a definite rejection puts the text back.
        if (syncComposer) {
          clearDraftForSend(origin, draftText)
        }
        const seededLaunchDraft = readSeededLaunchDraftSeed()
        const typesCodexCommand =
          agent === 'codex' &&
          classification !== 'chat' &&
          isSlashCommandDraft(text) &&
          !images?.length
        // Keep terminal controls in their own write. When bundled with the body,
        // a pasted burst can become literal prompt text instead of editing input.
        if (!images?.length && (seededLaunchDraft || !typesCodexCommand)) {
          const cleared = await clearMobileNativeChatInput({
            client,
            terminal: handle,
            clearInput: seededLaunchDraft
              ? buildAgentTuiClearInputForText(seededLaunchDraft.text)
              : AGENT_TUI_CLEAR_INPUT_LINE,
            deadline,
            ...(deviceTokenRef.current
              ? { mobileClient: { id: deviceTokenRef.current, type: 'mobile' } }
              : {})
          })
          if (!cleared || owner?.cancelled || operation?.canContinue?.() === false) {
            if (syncComposer) {
              restoreRejectedDraft(origin, draftText)
            }
            if (!owner?.cancelled && operation?.canContinue?.() !== false) {
              onSendError('Message not sent')
            }
            return 'rejected'
          }
        }
        const mobileClient = deviceTokenRef.current
          ? { id: deviceTokenRef.current, type: 'mobile' as const }
          : undefined
        const resolvedLaunchDraft =
          syncComposer && typeof seededLaunchDraft?.createdAt === 'number'
            ? { text: seededLaunchDraft.text, createdAt: seededLaunchDraft.createdAt }
            : undefined
        const outcome = typesCodexCommand
          ? await typeMobileNativeChatCommandWithOutcome({
              client,
              terminal: handle,
              command: text,
              ...(resolvedLaunchDraft ? { resolvedLaunchDraft } : {}),
              ...(mobileClient ? { mobileClient } : {}),
              deadline
            })
          : await sendMobileNativeChatMessageWithOutcome({
              client,
              terminal: handle,
              text: buildNativeChatPasteBytes(text),
              ...(resolvedLaunchDraft ? { resolvedLaunchDraft } : {}),
              deadline,
              ...(mobileClient ? { mobileClient } : {})
            })
        if (operation?.isCurrent?.() === false) {
          return 'rejected'
        }
        // Why (desktop parity): a slash/skill send dispatches into the agent's
        // own TUI, not the conversation — the transcript never echoes it as a
        // user turn, so an optimistic bubble would never reconcile and the
        // unconfirmed hold could never observe a landing.
        if (outcome === 'unknown') {
          if (classification === 'chat') {
            // Why: an ack-lost send usually WAS delivered (issue seen on
            // cellular relay) — verify via the transcript echo instead of a
            // false "not sent".
            holdUnconfirmedSend(
              chatOrigin,
              'Delivery unconfirmed — check chat before sending again'
            )
          }
          return 'unknown'
        }
        if (outcome === 'rejected') {
          if (syncComposer) {
            restoreRejectedDraft(origin, draftText)
          }
          onSendError('Message not sent')
          return 'rejected'
        }
        if (classification === 'chat') {
          // `images` are local preview URIs for the optimistic echo only — the
          // actual image bytes already rode along as a bracketed paste before
          // this text send.
          acceptSend(chatOrigin, text, images)
        } else if (recordControlSend) {
          // The session-option catalog can recognize controls omitted from the
          // autocomplete catalog (for example Claude `/model` and `/fast`).
          recordCommand(text.trim())
        }
        return 'accepted'
      } finally {
        releaseMobileNativeChatUnconfirmedSend(chatOrigin)
      }
    },
    [
      acceptSend,
      agentRef,
      captureSendOrigin,
      clearDraftForSend,
      client,
      commandSendRef,
      deviceTokenRef,
      enabled,
      handleRef,
      holdUnconfirmedSend,
      onSendError,
      readSeededLaunchDraftSeed,
      restoreRejectedDraft
    ]
  )

  const sendWithOutcome = useCallback(
    (text: string, images?: string[], deadline?: number) =>
      sendMessage(text, images, true, true, { deadline }),
    [sendMessage]
  )

  // Boolean surface for callers with no pre-pasted input: 'unknown' stays true
  // (the send usually landed; the optimistic echo is already held unconfirmed).
  const send = useCallback(
    async (text: string, images?: string[]): Promise<boolean> =>
      (await sendWithOutcome(text, images)) !== 'rejected',
    [sendWithOutcome]
  )

  // A question answer is not composer text, so it never syncs the draft. It
  // reaches this send directly (not through the image hook's locked path), so
  // it takes the per-terminal write lock itself: an answer landing mid-flight
  // in an image paste sequence would interleave bytes into the PTY.
  const answerQuestion = useCallback(
    async (text: string): Promise<boolean> => {
      const terminal = handleRef.current
      if (args.questionRequestIdentity === null || !canSendQuestion(terminal, true)) {
        return false
      }
      if (!canSendQuestion(terminal)) {
        if (!enabled) {
          onSendError('Message not sent (disconnected)')
        }
        return false
      }
      if (terminal && !acquireMobileNativeChatTerminalWrite(terminal)) {
        onSendError('Answer not sent')
        return false
      }
      try {
        return (
          (await sendMessage(text, undefined, false, true, {
            isCurrent: () => isCurrentQuestion(terminal),
            canContinue: () => canSendQuestion(terminal)
          })) !== 'rejected'
        )
      } finally {
        if (terminal) {
          releaseMobileNativeChatTerminalWrite(terminal)
        }
      }
    },
    [
      args.questionRequestIdentity,
      canSendQuestion,
      enabled,
      handleRef,
      isCurrentQuestion,
      onSendError,
      sendMessage
    ]
  )

  // A session-option apply writes to the same input line as a send, and the host
  // spaces a send's body and its Enter ~500ms apart — so without this lock an
  // apply lands between them and is submitted as part of the user's prompt.
  const dispatchCommand = useCallback(
    async (
      text: string,
      _options?: { delivery?: CatalogCommandDelivery }
    ): Promise<MobileNativeChatSendOutcome> => {
      const terminal = handleRef.current
      if (terminal && !acquireMobileNativeChatTerminalWrite(terminal)) {
        return 'rejected'
      }
      try {
        if (agentRef.current === 'codex') {
          if (!client || !terminal || !enabled) {
            return 'rejected'
          }
          const deadline = openMobileNativeChatSendBudget()
          const mobileClient = deviceTokenRef.current
            ? { id: deviceTokenRef.current, type: 'mobile' as const }
            : undefined
          if (
            !(await healMobileNativeChatStaleInput({
              client,
              terminal,
              deviceToken: deviceTokenRef.current,
              deadline
            }))
          ) {
            return 'rejected'
          }
          return typeMobileNativeChatCommandWithOutcome({
            client,
            terminal,
            command: text,
            ...(mobileClient ? { mobileClient } : {}),
            deadline
          })
        }
        return await sendMessage(text, undefined, false, false)
      } finally {
        if (terminal) {
          releaseMobileNativeChatTerminalWrite(terminal)
        }
      }
    },
    [client, deviceTokenRef, enabled, handleRef, sendMessage]
  )

  return { send, sendWithOutcome, answerQuestion, dispatchCommand }
}
