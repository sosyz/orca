import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  classifyTerminalLiveSendError,
  classifyTerminalLiveSendPreflight,
  classifyTerminalLiveSendResponse,
  createTerminalLiveSendConnectionLogEntry,
  getTerminalLiveSendToastMessage,
  shouldReportTerminalLiveSendFailure,
  type TerminalLiveSendFailureReportState,
  type TerminalLiveSendOutcome
} from './terminal-live-send-outcome'

const runtimeMeta = { runtimeId: 'test-runtime' } as const
const sessionRouteSource = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

function response(result: unknown): RpcResponse {
  return { id: '1', ok: true, result, _meta: runtimeMeta }
}

function routeSlice(anchorStart: string, anchorEnd: string): string {
  const start = sessionRouteSource.indexOf(anchorStart)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sessionRouteSource.indexOf(anchorEnd, start)
  expect(end).toBeGreaterThan(start)
  return sessionRouteSource.slice(start, end + anchorEnd.length)
}

describe('terminal live send outcome', () => {
  it('classifies local send gates without reading terminal input', () => {
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-a',
        activeSessionTabType: 'terminal',
        connState: 'connected',
        handle: 'terminal-a',
        hasClient: false
      })
    ).toEqual({ kind: 'rejected', bucket: 'local-no-client' })
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-a',
        activeSessionTabType: 'terminal',
        connState: 'reconnecting',
        handle: 'terminal-a',
        hasClient: true
      })
    ).toEqual({ kind: 'rejected', bucket: 'local-not-connected' })
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-b',
        activeSessionTabType: 'terminal',
        connState: 'connected',
        handle: 'terminal-a',
        hasClient: true
      })
    ).toEqual({ kind: 'rejected', bucket: 'local-stale-handle' })
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-a',
        activeSessionTabType: null,
        connState: 'connected',
        handle: 'terminal-a',
        hasClient: true
      })
    ).toEqual({ kind: 'rejected', bucket: 'local-tab-unknown' })
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-a',
        activeSessionTabType: 'browser',
        connState: 'connected',
        handle: 'terminal-a',
        hasClient: true
      })
    ).toEqual({ kind: 'rejected', bucket: 'local-tab-not-terminal' })
    expect(
      classifyTerminalLiveSendPreflight({
        activeHandle: 'terminal-a',
        activeSessionTabType: 'terminal',
        connState: 'connected',
        handle: 'terminal-a',
        hasClient: true
      })
    ).toBeNull()
  })

  it('classifies accepted, refused, and malformed RPC responses with allowlisted buckets', () => {
    expect(
      classifyTerminalLiveSendResponse(response({ send: { accepted: true, bytesWritten: 1 } }))
    ).toEqual({ kind: 'accepted' })
    expect(
      classifyTerminalLiveSendResponse(response({ send: { accepted: false, bytesWritten: 0 } }))
    ).toEqual({ kind: 'rejected', bucket: 'rpc-not-accepted' })
    expect(
      classifyTerminalLiveSendResponse(
        response({ send: { accepted: false, bytesWritten: 0, refusedReason: 'permission' } })
      )
    ).toEqual({ kind: 'rejected', bucket: 'rpc-permission' })
    expect(
      classifyTerminalLiveSendResponse(
        response({ send: { accepted: false, bytesWritten: 0, refusedReason: 'no-agent' } })
      )
    ).toEqual({ kind: 'rejected', bucket: 'rpc-no-agent' })
    expect(
      classifyTerminalLiveSendResponse(
        response({ send: { accepted: false, bytesWritten: 0, agentSessionRefusal: {} } })
      )
    ).toEqual({ kind: 'rejected', bucket: 'rpc-agent-session-refused' })
    expect(
      classifyTerminalLiveSendResponse({
        id: '2',
        ok: false,
        error: { code: 'runtime_error', message: 'mobile_input_floor_unavailable' },
        _meta: runtimeMeta
      })
    ).toEqual({ kind: 'rejected', bucket: 'rpc-input-lease-missing' })
    expect(
      classifyTerminalLiveSendResponse({
        id: '3',
        ok: false,
        error: { code: 'secret-code', message: 'token=secret should not be copied' },
        _meta: runtimeMeta
      })
    ).toEqual({ kind: 'rejected', bucket: 'rpc-error-response' })
    expect(classifyTerminalLiveSendResponse(response({ send: {} }))).toEqual({
      kind: 'unknown',
      bucket: 'rpc-malformed-response'
    })
  })

  it('keeps delivery-unknown failures distinct from definite rejections', () => {
    expect(
      classifyTerminalLiveSendError(markRpcDeliveryUnknown(new Error('Connection closed')))
    ).toEqual({
      kind: 'unknown',
      bucket: 'rpc-delivery-unknown'
    })
    expect(classifyTerminalLiveSendError(new LogicalClientCutoverError())).toEqual({
      kind: 'unknown',
      bucket: 'logical-client-cutover'
    })
    expect(classifyTerminalLiveSendError(new Error('Connection refused'))).toEqual({
      kind: 'rejected',
      bucket: 'rpc-error'
    })
  })

  it('uses user-facing copy that does not overclaim unknown delivery as failed', () => {
    expect(getTerminalLiveSendToastMessage({ kind: 'accepted' })).toBeNull()
    expect(
      getTerminalLiveSendToastMessage({ kind: 'unknown', bucket: 'rpc-delivery-unknown' })
    ).toBe('Terminal input may have been sent. Check before retrying.')
    expect(getTerminalLiveSendToastMessage({ kind: 'rejected', bucket: 'rpc-not-accepted' })).toBe(
      'Terminal input was not accepted. Check terminal connection before continuing.'
    )
  })

  it('builds content-free connection log entries', () => {
    const outcome: TerminalLiveSendOutcome = { kind: 'rejected', bucket: 'rpc-error-response' }
    const entry = createTerminalLiveSendConnectionLogEntry({
      byteLength: 3,
      handle: 'terminal-secret-token-12345678',
      now: 1000,
      outcome
    })

    expect(entry).toEqual({
      id: expect.stringMatching(/^terminal-live-send-1000-\d+-rejected-rpc-error-response$/),
      ts: 1000,
      level: 'warn',
      message: 'Live terminal input not accepted',
      detail: 'bucket=rpc-error-response handle=12345678 bytes=3'
    })
    expect(JSON.stringify(entry)).not.toContain('typed-secret')
    expect(JSON.stringify(entry)).not.toContain('terminal-secret-token')
  })

  it('dedupes repeated visible reports per handle and bucket without storing full handles', () => {
    const first = shouldReportTerminalLiveSendFailure({
      handle: 'terminal-secret-token-12345678',
      now: 1_000,
      outcome: { kind: 'rejected', bucket: 'rpc-not-accepted' },
      previous: null
    })
    expect(first.report).toBe(true)
    expect(first.next).toEqual<TerminalLiveSendFailureReportState>({
      bucket: 'rpc-not-accepted',
      handleSuffix: '12345678',
      kind: 'rejected',
      reportedAt: 1_000
    })

    const repeated = shouldReportTerminalLiveSendFailure({
      handle: 'terminal-secret-token-12345678',
      now: 2_000,
      outcome: { kind: 'rejected', bucket: 'rpc-not-accepted' },
      previous: first.next
    })
    expect(repeated.report).toBe(false)
    expect(JSON.stringify(repeated.next)).not.toContain('terminal-secret-token')

    const changedBucket = shouldReportTerminalLiveSendFailure({
      handle: 'terminal-secret-token-12345678',
      now: 2_500,
      outcome: { kind: 'unknown', bucket: 'rpc-delivery-unknown' },
      previous: repeated.next
    })
    expect(changedBucket.report).toBe(true)

    const accepted = shouldReportTerminalLiveSendFailure({
      handle: 'terminal-secret-token-12345678',
      now: 3_000,
      outcome: { kind: 'accepted' },
      previous: changedBucket.next
    })
    expect(accepted).toEqual({ next: null, report: false })
  })

  it('wires the session route through classified outcomes and content-free diagnostics', () => {
    const reportOutcome = routeSlice(
      'const reportTerminalLiveSendOutcome = useCallback(',
      'const sendLiveTerminalInput = useCallback('
    )
    expect(reportOutcome).toContain('shouldReportTerminalLiveSendFailure({')
    expect(reportOutcome).toContain('connectionLogStore.append(hostId, entry)')
    expect(reportOutcome).toContain('getTerminalLiveSendToastMessage(outcome)')
    expect(reportOutcome.indexOf('getByteLength()')).toBeLessThan(
      reportOutcome.indexOf('connectionLogStore.append(hostId, entry)')
    )
    expect(reportOutcome.indexOf('handle !== activeHandleRef.current')).toBeLessThan(
      reportOutcome.indexOf('getTerminalLiveSendToastMessage(outcome)')
    )

    const liveSend = routeSlice(
      'const sendLiveTerminalInput = useCallback(',
      'sendLiveTerminalInputRef.current = sendLiveTerminalInput'
    )
    expect(liveSend).toContain(
      'const getByteLength = (): number => terminalLiveSendLogEncoder.encode(text).byteLength'
    )
    expect(liveSend).toContain('classifyTerminalLiveSendPreflight({')
    expect(liveSend).toContain('classifyTerminalLiveSendResponse(response)')
    expect(liveSend).toContain('classifyTerminalLiveSendError(error)')
    expect(liveSend).toContain('TERMINAL_INPUT_SEND_OPTIONS')
    expect(liveSend).toContain("return outcome.kind === 'accepted'")
    expect(liveSend).not.toContain('isTerminalSendRpcAccepted')
  })
})
