import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type {
  ConnectionLogEntry,
  ConnectionState,
  RpcFailure,
  RpcResponse
} from '../transport/types'
import { shortenMobileTerminalDiagnosticId } from '../session/mobile-terminal-diagnostics'
import { isTerminalSendRpcAccepted } from './terminal-send-rpc-response'

const TERMINAL_LIVE_SEND_TOAST_DEDUPE_MS = 4_000
const TERMINAL_LIVE_INPUT_FLOOR_UNAVAILABLE = 'mobile_input_floor_unavailable'

let terminalLiveSendLogSequence = 0

export type TerminalLiveSendBucket =
  | 'local-no-client'
  | 'local-not-connected'
  | 'local-stale-handle'
  | 'local-tab-unknown'
  | 'local-tab-not-terminal'
  | 'logical-client-cutover'
  | 'rpc-agent-session-refused'
  | 'rpc-delivery-unknown'
  | 'rpc-error'
  | 'rpc-error-response'
  | 'rpc-input-lease-missing'
  | 'rpc-malformed-response'
  | 'rpc-no-agent'
  | 'rpc-not-accepted'
  | 'rpc-permission'

export type TerminalLiveSendOutcome =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'rejected' | 'unknown'; readonly bucket: TerminalLiveSendBucket }

export type TerminalLiveSendFailureReportState = {
  readonly bucket: TerminalLiveSendBucket
  readonly handleSuffix: string | null
  readonly kind: 'rejected' | 'unknown'
  readonly reportedAt: number
}

export function classifyTerminalLiveSendPreflight(args: {
  readonly activeHandle: string | null
  readonly activeSessionTabType: string | null
  readonly connState: ConnectionState
  readonly handle: string
  readonly hasClient: boolean
}): TerminalLiveSendOutcome | null {
  if (!args.hasClient) {
    return { kind: 'rejected', bucket: 'local-no-client' }
  }
  if (args.connState !== 'connected') {
    return { kind: 'rejected', bucket: 'local-not-connected' }
  }
  if (args.handle !== args.activeHandle) {
    return { kind: 'rejected', bucket: 'local-stale-handle' }
  }
  if (args.activeSessionTabType === null) {
    return { kind: 'rejected', bucket: 'local-tab-unknown' }
  }
  if (args.activeSessionTabType !== 'terminal') {
    return { kind: 'rejected', bucket: 'local-tab-not-terminal' }
  }
  return null
}

export function classifyTerminalLiveSendResponse(response: RpcResponse): TerminalLiveSendOutcome {
  if (!response.ok) {
    return classifyTerminalLiveSendFailureResponse(response)
  }
  if (isTerminalSendRpcAccepted(response)) {
    return { kind: 'accepted' }
  }
  const send = readTerminalSendResult(response.result)
  if (!send) {
    return { kind: 'unknown', bucket: 'rpc-malformed-response' }
  }
  if (send.agentSessionRefusal) {
    return { kind: 'rejected', bucket: 'rpc-agent-session-refused' }
  }
  if (send.refusedReason === 'permission') {
    return { kind: 'rejected', bucket: 'rpc-permission' }
  }
  if (send.refusedReason === 'no-agent') {
    return { kind: 'rejected', bucket: 'rpc-no-agent' }
  }
  return { kind: 'rejected', bucket: 'rpc-not-accepted' }
}

export function classifyTerminalLiveSendError(error: unknown): TerminalLiveSendOutcome {
  if (isRpcDeliveryUnknown(error)) {
    return { kind: 'unknown', bucket: 'rpc-delivery-unknown' }
  }
  if (isLogicalClientCutoverError(error)) {
    return { kind: 'unknown', bucket: 'logical-client-cutover' }
  }
  return { kind: 'rejected', bucket: 'rpc-error' }
}

export function getTerminalLiveSendToastMessage(outcome: TerminalLiveSendOutcome): string | null {
  if (outcome.kind === 'accepted') {
    return null
  }
  return outcome.kind === 'unknown'
    ? 'Terminal input may have been sent. Check before retrying.'
    : 'Terminal input was not accepted. Check terminal connection before continuing.'
}

export function createTerminalLiveSendConnectionLogEntry(args: {
  readonly byteLength: number
  readonly handle: string
  readonly now?: number
  readonly outcome: TerminalLiveSendOutcome
}): ConnectionLogEntry | null {
  if (args.outcome.kind === 'accepted') {
    return null
  }
  const now = args.now ?? Date.now()
  const bytes = Number.isFinite(args.byteLength) ? Math.max(0, Math.floor(args.byteLength)) : 0
  const message =
    args.outcome.kind === 'unknown'
      ? 'Live terminal input delivery unconfirmed'
      : 'Live terminal input not accepted'
  terminalLiveSendLogSequence = (terminalLiveSendLogSequence + 1) % Number.MAX_SAFE_INTEGER
  return {
    id: `terminal-live-send-${now}-${terminalLiveSendLogSequence}-${args.outcome.kind}-${args.outcome.bucket}`,
    ts: now,
    level: 'warn',
    message,
    detail: `bucket=${args.outcome.bucket} handle=${shortenMobileTerminalDiagnosticId(args.handle)} bytes=${bytes}`
  }
}

export function shouldReportTerminalLiveSendFailure(args: {
  readonly cooldownMs?: number
  readonly handle: string
  readonly now: number
  readonly outcome: TerminalLiveSendOutcome
  readonly previous: TerminalLiveSendFailureReportState | null
}): {
  readonly next: TerminalLiveSendFailureReportState | null
  readonly report: boolean
} {
  if (args.outcome.kind === 'accepted') {
    return { next: null, report: false }
  }
  const next: TerminalLiveSendFailureReportState = {
    bucket: args.outcome.bucket,
    handleSuffix: shortenMobileTerminalDiagnosticId(args.handle),
    kind: args.outcome.kind,
    reportedAt: args.now
  }
  const cooldownMs = args.cooldownMs ?? TERMINAL_LIVE_SEND_TOAST_DEDUPE_MS
  const previous = args.previous
  if (
    previous &&
    previous.kind === next.kind &&
    previous.bucket === next.bucket &&
    previous.handleSuffix === next.handleSuffix &&
    args.now - previous.reportedAt < cooldownMs
  ) {
    return { next: previous, report: false }
  }
  return { next, report: true }
}

function classifyTerminalLiveSendFailureResponse(response: RpcFailure): TerminalLiveSendOutcome {
  if (
    response.error.code === 'runtime_error' &&
    response.error.message === TERMINAL_LIVE_INPUT_FLOOR_UNAVAILABLE
  ) {
    return { kind: 'rejected', bucket: 'rpc-input-lease-missing' }
  }
  return { kind: 'rejected', bucket: 'rpc-error-response' }
}

type TerminalSendResult = {
  readonly accepted: boolean
  readonly agentSessionRefusal?: unknown
  readonly refusedReason?: unknown
}

function readTerminalSendResult(value: unknown): TerminalSendResult | null {
  if (!isRecord(value) || !isRecord(value.send) || typeof value.send.accepted !== 'boolean') {
    return null
  }
  return {
    accepted: value.send.accepted,
    agentSessionRefusal: value.send.agentSessionRefusal,
    refusedReason: value.send.refusedReason
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
