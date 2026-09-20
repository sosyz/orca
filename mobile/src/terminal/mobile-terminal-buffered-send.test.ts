import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  beginBufferedTerminalDraftRestoration,
  invalidateBufferedTerminalDraftRestoration,
  restoreRejectedBufferedTerminalDraft,
  settleBufferedTerminalDraftRestoration,
  type BufferedTerminalDraftRestorationToken
} from './buffered-terminal-draft-restoration'
import {
  createMobileTerminalBufferedSendState,
  sendMobileTerminalBufferedCommand,
  type MobileTerminalBufferedSendScope
} from './mobile-terminal-buffered-send'

const acceptedResponse = {
  id: '1',
  ok: true,
  result: { send: { handle: 'terminal-a', accepted: true, bytesWritten: 3 } },
  _meta: { runtimeId: 'test' }
} as RpcResponse

const rejectedResponse = {
  ...acceptedResponse,
  result: { send: { handle: 'terminal-a', accepted: false, bytesWritten: 0 } }
} as RpcResponse

const failedResponse = {
  id: '1',
  ok: false,
  error: { code: 'terminal_error', message: 'failed' },
  _meta: { runtimeId: 'test' }
} as RpcResponse

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function harness(initialResponse: Promise<RpcResponse>) {
  const requests = vi.fn(() => initialResponse)
  const client = { sendRequest: requests } as unknown as RpcClient
  let scope: MobileTerminalBufferedSendScope | null = {
    client,
    handle: 'terminal-a',
    hostId: 'host-a',
    worktreeId: 'worktree-a',
    tabId: 'tab-a'
  }
  let drafts: Record<string, string> = { 'terminal-a': 'first' }
  const restorations = new Map<string, BufferedTerminalDraftRestorationToken>()
  const state = createMobileTerminalBufferedSendState()
  const outcomes: string[] = []
  const acceptedUnchanged: boolean[] = []
  const send = (target = scope, text = target ? (drafts[target.handle] ?? '') : '') =>
    sendMobileTerminalBufferedCommand({
      state,
      scope: target,
      getCurrentScope: () => scope,
      draft: text,
      deviceToken: 'device-a',
      beginDraftSend: () => {
        const token = beginBufferedTerminalDraftRestoration(restorations, target!.handle)
        drafts = { ...drafts, [target!.handle]: '' }
        return {
          restoreRejectedDraft: () => {
            if (settleBufferedTerminalDraftRestoration(restorations, target!.handle, token)) {
              drafts = restoreRejectedBufferedTerminalDraft(drafts, token.handle, text)
            }
          },
          settle: () => settleBufferedTerminalDraftRestoration(restorations, target!.handle, token)
        }
      },
      canRestoreDraft: () =>
        scope !== null &&
        target !== null &&
        scope.client === target.client &&
        scope.hostId === target.hostId &&
        scope.worktreeId === target.worktreeId,
      onAccepted: (unchanged) => acceptedUnchanged.push(unchanged),
      onFailure: (outcome) => outcomes.push(outcome.kind)
    })
  return {
    client,
    requests,
    state,
    send,
    outcomes,
    acceptedUnchanged,
    get draft() {
      return drafts[scope?.handle ?? 'terminal-a'] ?? ''
    },
    draftFor(handle: string) {
      return drafts[handle] ?? ''
    },
    get scope() {
      return scope
    },
    set scope(value: MobileTerminalBufferedSendScope | null) {
      scope = value
    },
    editDraft(text: string) {
      if (!scope) {
        return
      }
      invalidateBufferedTerminalDraftRestoration(restorations, scope.handle)
      drafts = { ...drafts, [scope.handle]: text }
    }
  }
}

describe('mobile buffered terminal send', () => {
  it('keeps a newer draft when the previous send is rejected', async () => {
    const pending = deferred<RpcResponse>()
    const h = harness(pending.promise)
    const send = h.send()
    expect(h.draft).toBe('')
    h.editDraft('next command')
    pending.resolve(rejectedResponse)
    expect(await send).toBe('rejected')
    expect(h.draft).toBe('next command')
  })

  it.each([rejectedResponse, failedResponse])(
    'restores the untouched original draft after an explicit RPC rejection',
    async (response) => {
      const h = harness(Promise.resolve(response))
      expect(await h.send()).toBe('rejected')
      expect(h.draft).toBe('first')
      expect(h.outcomes).toEqual(['rejected'])
    }
  )

  it('reports delivery-unknown without retrying the command', async () => {
    const h = harness(Promise.reject(markRpcDeliveryUnknown(new Error('ack lost'))))
    expect(await h.send()).toBe('unknown')
    expect(h.draft).toBe('first')
    expect(h.requests).toHaveBeenCalledTimes(1)
    expect(h.outcomes).toEqual(['unknown'])
  })

  it('clears the original draft only after targeting its captured client and handle', async () => {
    const h = harness(Promise.resolve(acceptedResponse))
    expect(await h.send()).toBe('accepted')
    expect(h.draft).toBe('')
    expect(h.requests).toHaveBeenCalledWith(
      'terminal.send',
      {
        terminal: 'terminal-a',
        text: 'first',
        enter: true,
        client: { id: 'device-a', type: 'mobile' }
      },
      { failWhenDisconnected: true }
    )
  })

  it('ignores an old callback after client, tab, or route scope changes', async () => {
    const h = harness(Promise.resolve(acceptedResponse))
    const oldScope = h.scope
    h.scope = { ...oldScope!, client: { sendRequest: vi.fn() } as unknown as RpcClient }
    expect(await h.send(oldScope)).toBe('skipped')
    h.scope = { ...oldScope!, tabId: 'tab-b' }
    expect(await h.send(oldScope)).toBe('skipped')
    h.scope = { ...oldScope!, handle: 'terminal-b' }
    expect(await h.send(oldScope)).toBe('skipped')
    h.scope = { ...oldScope!, worktreeId: 'worktree-b' }
    expect(await h.send(oldScope)).toBe('skipped')
    h.scope = { ...oldScope!, hostId: 'host-b' }
    expect(await h.send(oldScope)).toBe('skipped')
    expect(h.requests).not.toHaveBeenCalled()
    expect(h.draft).toBe('first')
  })

  it('does not restore or notify after its screen unmounts', async () => {
    const pending = deferred<RpcResponse>()
    const h = harness(pending.promise)
    const send = h.send()
    h.scope = null
    pending.resolve(failedResponse)
    expect(await send).toBe('rejected')
    expect(h.draft).toBe('')
    expect(h.outcomes).toEqual([])
  })

  it('restores a rejected A draft while B stays visible without reporting A failure on B', async () => {
    const pending = deferred<RpcResponse>()
    const h = harness(pending.promise)
    const sendA = h.send()
    h.scope = { ...h.scope!, handle: 'terminal-b', tabId: 'tab-b' }
    h.editDraft('B command')

    pending.resolve(rejectedResponse)
    expect(await sendA).toBe('rejected')
    expect(h.draftFor('terminal-a')).toBe('first')
    expect(h.draft).toBe('B command')
    expect(h.outcomes).toEqual([])
  })

  it('does not let an old send completion unlock a new scope send', async () => {
    const oldPending = deferred<RpcResponse>()
    const h = harness(oldPending.promise)
    const oldSend = h.send()
    const newPending = deferred<RpcResponse>()
    const newClient = { sendRequest: vi.fn(() => newPending.promise) } as unknown as RpcClient
    h.scope = { ...h.scope!, client: newClient, handle: 'terminal-b', tabId: 'tab-b' }
    h.editDraft('second')
    const newSend = h.send()
    oldPending.resolve(rejectedResponse)
    expect(await oldSend).toBe('rejected')
    expect(h.draft).toBe('')
    expect(await h.send()).toBe('skipped')
    newPending.resolve(acceptedResponse)
    expect(await newSend).toBe('accepted')
    expect(h.draft).toBe('')
    expect(newClient.sendRequest as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  it('keeps A locked across A to B to A while B can send independently', async () => {
    const firstA = deferred<RpcResponse>()
    const sendB = deferred<RpcResponse>()
    const nextA = deferred<RpcResponse>()
    const h = harness(firstA.promise)
    h.requests
      .mockImplementationOnce(() => firstA.promise)
      .mockImplementationOnce(() => sendB.promise)
      .mockImplementationOnce(() => nextA.promise)
    const scopeA = h.scope
    const firstSendA = h.send()

    h.scope = { ...scopeA!, handle: 'terminal-b', tabId: 'tab-b' }
    h.editDraft('B command')
    const pendingB = h.send()
    expect(h.requests).toHaveBeenCalledTimes(2)

    h.scope = scopeA
    h.editDraft('next A command')
    const repeatedA = h.send()
    expect(h.requests).toHaveBeenCalledTimes(2)
    expect(await repeatedA).toBe('skipped')
    expect(h.draft).toBe('next A command')

    firstA.resolve(acceptedResponse)
    expect(await firstSendA).toBe('accepted')
    const secondSendA = h.send()
    expect(h.requests).toHaveBeenCalledTimes(3)
    sendB.resolve(acceptedResponse)
    nextA.resolve(acceptedResponse)
    expect(await pendingB).toBe('accepted')
    expect(await secondSendA).toBe('accepted')
  })
})
