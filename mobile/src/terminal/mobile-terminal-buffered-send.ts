import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from './terminal-send-request'
import { isTerminalSendRpcAccepted } from './terminal-send-rpc-response'
import {
  classifyTerminalLiveSendError,
  classifyTerminalLiveSendResponse,
  type TerminalLiveSendOutcome
} from './terminal-live-send-outcome'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'

export type MobileTerminalBufferedSendScope = {
  readonly client: RpcClient
  readonly handle: string
  readonly hostId: string
  readonly worktreeId: string
  readonly tabId: string | null
}

type PendingBufferedSend = {
  readonly scope: MobileTerminalBufferedSendScope
}

export type MobileTerminalBufferedSendState = {
  pending: Set<PendingBufferedSend>
}

export function createMobileTerminalBufferedSendState(): MobileTerminalBufferedSendState {
  return { pending: new Set() }
}

type BufferedDraftSend = {
  restoreRejectedDraft: () => void
  settle: () => boolean
}

function sameScope(
  left: MobileTerminalBufferedSendScope | null,
  right: MobileTerminalBufferedSendScope | null
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.client === right.client &&
    left.handle === right.handle &&
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.tabId === right.tabId
  )
}

export async function sendMobileTerminalBufferedCommand(args: {
  readonly state: MobileTerminalBufferedSendState
  readonly scope: MobileTerminalBufferedSendScope | null
  readonly getCurrentScope: () => MobileTerminalBufferedSendScope | null
  readonly draft: string
  readonly deviceToken: string | null
  readonly beginDraftSend: () => BufferedDraftSend
  readonly canRestoreDraft: () => boolean
  readonly onAccepted: (draftUnchanged: boolean) => void
  readonly onFailure: (outcome: Exclude<TerminalLiveSendOutcome, { kind: 'accepted' }>) => void
}): Promise<'accepted' | 'rejected' | 'unknown' | 'skipped'> {
  const { state, scope } = args
  if (!scope || !sameScope(scope, args.getCurrentScope())) {
    return 'skipped'
  }
  if ([...state.pending].some((request) => sameScope(request.scope, scope))) {
    return 'skipped'
  }

  const pending = { scope }
  state.pending.add(pending)
  let draftSend: BufferedDraftSend | null = null

  try {
    const text = normalizeTerminalTextInput(args.draft)
    draftSend = args.beginDraftSend()
    let outcome: TerminalLiveSendOutcome
    try {
      const response = await scope.client.sendRequest(
        'terminal.send',
        buildTerminalSendParams({
          terminal: scope.handle,
          text,
          enter: true,
          deviceToken: args.deviceToken
        }),
        TERMINAL_INPUT_SEND_OPTIONS
      )
      outcome = isTerminalSendRpcAccepted(response)
        ? { kind: 'accepted' }
        : classifyTerminalLiveSendResponse(response)
    } catch (error) {
      outcome = classifyTerminalLiveSendError(error)
    }

    if (outcome.kind === 'accepted') {
      const draftUnchanged = draftSend.settle()
      if (scope === args.getCurrentScope()) {
        args.onAccepted(draftUnchanged)
      }
    } else {
      if (args.canRestoreDraft()) {
        draftSend.restoreRejectedDraft()
      }
      if (scope === args.getCurrentScope()) {
        args.onFailure(outcome)
      }
    }
    return outcome.kind
  } finally {
    draftSend?.settle()
    state.pending.delete(pending)
  }
}
