import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'
import {
  isMobileNativeChatInputStale,
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { useMobileDiffReviewSendActions } from './use-mobile-diff-review-send-actions'

type SendActions = ReturnType<typeof useMobileDiffReviewSendActions>

vi.mock('../platform/haptics', () => ({ triggerSuccess: vi.fn() }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn().mockResolvedValue(undefined) }))

function sendResponse(accepted: boolean) {
  return {
    id: 'send',
    ok: true as const,
    result: { send: { accepted } },
    _meta: { runtimeId: 'runtime' }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const COMMENT: DiffComment = {
  id: 'comment-1',
  worktreeId: 'wt-1',
  filePath: 'src/a.ts',
  lineNumber: 3,
  body: 'rename this',
  createdAt: 1,
  side: 'modified'
}

const READY: ReviewScreenState = {
  kind: 'ready',
  status: { entries: [], conflictOperation: 'none' },
  branchCompare: null,
  comments: [COMMENT],
  reviewState: { version: 1, files: {} }
}

describe('useMobileDiffReviewSendActions', () => {
  let renderer: ReactTestRenderer | null = null
  let actions: SendActions | null = null
  let mountedClient: RpcClient | null = null
  let mountedWorktreeId = 'wt-1'
  let setActionError: ReturnType<typeof vi.fn>
  let setSendSheet: ReturnType<typeof vi.fn>
  let saveCommentsAndReviewState: ReturnType<typeof vi.fn>
  let markSentComments: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetMobileNativeChatStaleInputForTests()
    setActionError = vi.fn()
    setSendSheet = vi.fn()
    saveCommentsAndReviewState = vi.fn().mockResolvedValue(undefined)
    markSentComments = vi.fn().mockResolvedValue(true)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    actions = null
    mountedClient = null
    mountedWorktreeId = 'wt-1'
  })

  function Harness(): null {
    actions = useMobileDiffReviewSendActions({
      client: mountedClient,
      connState: 'connected',
      worktreeId: mountedWorktreeId,
      screenState: READY,
      setActionError,
      setSendSheet,
      saveCommentsAndReviewState,
      markSentComments
    })
    return null
  }

  async function mount(client: RpcClient): Promise<void> {
    mountedClient = client
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  it('heals a marked terminal BEFORE submitting the notes', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(true))
    await mount({ sendRequest } as unknown as RpcClient)
    markMobileNativeChatInputStale('terminal-1')

    await act(async () => {
      await actions?.sendPromptToTerminal('terminal-1', [COMMENT])
    })

    expect(sendRequest).toHaveBeenCalledTimes(2)
    // Order matters: the Ctrl+U clear must land before the enter-carrying write,
    // or the orphaned paste is submitted with the notes.
    expect(sendRequest.mock.calls[0]?.[1]).toMatchObject({
      terminal: 'terminal-1',
      text: '\x15',
      enter: false
    })
    expect(sendRequest.mock.calls[1]?.[1]).toMatchObject({ terminal: 'terminal-1', enter: true })
    // The second call is the notes themselves, not another clear.
    expect(String(sendRequest.mock.calls[1]?.[1]?.text)).toContain('rename this')
    expect(isMobileNativeChatInputStale('terminal-1')).toBe(false)
    expect(setActionError).toHaveBeenCalledWith('Review notes sent')
  })

  it('does not submit when the heal reports the line is not safe', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(false))
    await mount({ sendRequest } as unknown as RpcClient)
    markMobileNativeChatInputStale('terminal-1')

    let error: unknown
    await act(async () => {
      error = await actions?.sendPromptToTerminal('terminal-1', [COMMENT]).catch((err) => err)
    })

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Failed to send notes')
    // Only the failed clear — never the notes.
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[1]).toMatchObject({ text: '\x15', enter: false })
    expect(markSentComments).not.toHaveBeenCalled()
    expect(setActionError).toHaveBeenLastCalledWith('Failed to send notes')
    expect(setSendSheet).not.toHaveBeenCalled()
    // Marker survives for the next attempt.
    expect(isMobileNativeChatInputStale('terminal-1')).toBe(true)
  })

  it('keeps the marker and skips the notes when the clear throws', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('offline'))
    await mount({ sendRequest } as unknown as RpcClient)
    markMobileNativeChatInputStale('terminal-1')

    let error: unknown
    await act(async () => {
      error = await actions?.sendPromptToTerminal('terminal-1', [COMMENT]).catch((err) => err)
    })

    expect((error as Error).message).toBe('Failed to send notes')
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(markSentComments).not.toHaveBeenCalled()
    expect(isMobileNativeChatInputStale('terminal-1')).toBe(true)
  })

  it('sends an unmarked terminal with no extra RPC', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(true))
    await mount({ sendRequest } as unknown as RpcClient)

    await act(async () => {
      await actions?.sendPromptToTerminal('terminal-1', [COMMENT])
    })

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.send')
    expect(sendRequest.mock.calls[0]?.[1]).toMatchObject({ terminal: 'terminal-1', enter: true })
    expect(markSentComments).toHaveBeenCalledWith([COMMENT])
    expect(setActionError).toHaveBeenCalledWith('Review notes sent')
    expect(setSendSheet).toHaveBeenCalledWith(null)
  })

  it('only heals the terminal that was marked', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(true))
    await mount({ sendRequest } as unknown as RpcClient)
    markMobileNativeChatInputStale('terminal-other')

    await act(async () => {
      await actions?.sendPromptToTerminal('terminal-1', [COMMENT])
    })

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(isMobileNativeChatInputStale('terminal-other')).toBe(true)
  })

  it('still reports a rejected terminal.send after a successful heal', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(sendResponse(true))
      .mockResolvedValueOnce(sendResponse(false))
    await mount({ sendRequest } as unknown as RpcClient)
    markMobileNativeChatInputStale('terminal-1')

    let error: unknown
    await act(async () => {
      error = await actions?.sendPromptToTerminal('terminal-1', [COMMENT]).catch((err) => err)
    })

    expect((error as Error).message).toBe('Terminal input is locked')
    expect(markSentComments).not.toHaveBeenCalled()
  })

  it('reports a failed terminal.send response', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ id: 'send', ok: false, error: { message: 'pane gone' } })
    await mount({ sendRequest } as unknown as RpcClient)

    let error: unknown
    await act(async () => {
      error = await actions?.sendPromptToTerminal('terminal-1', [COMMENT]).catch((err) => err)
    })

    expect((error as Error).message).toBe('pane gone')
    expect(markSentComments).not.toHaveBeenCalled()
  })

  it('distinguishes accepted terminal delivery from a failed review-state save', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(true))
    markSentComments.mockRejectedValue(new Error('metadata offline'))
    await mount({ sendRequest } as unknown as RpcClient)

    let error: unknown
    await act(async () => {
      error = await actions?.sendPromptToTerminal('terminal-1', [COMMENT]).catch((err) => err)
    })

    expect((error as Error).message).toContain(
      'Notes were sent, but review state could not be saved'
    )
    expect(setActionError).toHaveBeenLastCalledWith(expect.stringContaining('Check delivery'))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(markSentComments).toHaveBeenCalledTimes(1)
  })

  it('does not suggest resending when a new terminal accepted notes but metadata failed', async () => {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'session.tabs.createTerminal'
        ? { ok: true, result: { tab: { id: 'tab-1', type: 'terminal', terminal: 'terminal-1' } } }
        : sendResponse(true)
    )
    markSentComments.mockRejectedValue(new Error('metadata offline'))
    await mount({ sendRequest } as unknown as RpcClient)

    await act(async () => {
      await actions!.createTerminalAndSend([COMMENT]).catch(() => {})
    })

    expect(setActionError).toHaveBeenLastCalledWith(
      'Notes were sent, but review state could not be saved. Check delivery before sending again.'
    )
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'session.tabs.createTerminal',
      'terminal.send'
    ])
  })

  it('ignores a terminal list response after the review scope changes', async () => {
    const oldList = deferred<unknown>()
    await mount({ sendRequest: vi.fn(() => oldList.promise) } as unknown as RpcClient)
    let opening!: Promise<void>
    act(() => {
      opening = actions!.openSendSheet()
    })
    await act(async () => {
      mountedClient = { sendRequest: vi.fn() } as unknown as RpcClient
      mountedWorktreeId = 'wt-2'
      renderer?.update(createElement(Harness))
    })

    await act(async () => {
      oldList.resolve({ ok: true, result: { tabs: [] } })
      await opening
    })
    expect(setSendSheet).toHaveBeenCalledTimes(1)
    expect(setSendSheet).toHaveBeenCalledWith({ kind: 'loading' })
  })

  it('does not let an old send callback run after switching away and back', async () => {
    const sendRequest = vi.fn().mockResolvedValue(sendResponse(true))
    await mount({ sendRequest } as unknown as RpcClient)
    const oldActions = actions!

    await act(async () => {
      mountedWorktreeId = 'wt-2'
      renderer?.update(createElement(Harness))
    })
    await act(async () => {
      mountedWorktreeId = 'wt-1'
      renderer?.update(createElement(Harness))
      await oldActions.sendPromptToTerminal('terminal-1', [COMMENT])
    })

    expect(sendRequest).not.toHaveBeenCalled()
    expect(markSentComments).not.toHaveBeenCalled()
  })

  it('does not create two terminal tabs when New Agent Session is pressed twice', async () => {
    const creation = deferred<unknown>()
    const sendRequest = vi.fn((method: string) =>
      method === 'session.tabs.createTerminal'
        ? creation.promise
        : Promise.resolve(sendResponse(true))
    )
    await mount({ sendRequest } as unknown as RpcClient)

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = actions!.createTerminalAndSend([COMMENT])
      second = actions!.createTerminalAndSend([COMMENT])
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.createTerminal')
    ).toHaveLength(1)

    await act(async () => {
      creation.resolve({
        ok: true,
        result: { tab: { id: 'tab-1', type: 'terminal', terminal: 'terminal-1' } }
      })
      await Promise.all([first, second])
    })
    expect(sendRequest.mock.calls.filter(([method]) => method === 'terminal.send')).toHaveLength(1)
  })

  it('does not send the same notes twice when an existing terminal is pressed twice', async () => {
    const send = deferred<unknown>()
    const sendRequest = vi.fn(() => send.promise)
    await mount({ sendRequest } as unknown as RpcClient)

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = actions!.sendPromptToTerminal('terminal-1', [COMMENT])
      second = actions!.sendPromptToTerminal('terminal-1', [COMMENT])
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(actions?.sendBusy).toBe(true)

    await act(async () => {
      send.resolve(sendResponse(true))
      await Promise.all([first, second])
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(actions?.sendBusy).toBe(false)
  })

  it('keeps the created terminal selectable when sending its notes fails', async () => {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'session.tabs.createTerminal'
        ? { ok: true, result: { tab: { id: 'tab-1', type: 'terminal', terminal: 'terminal-1' } } }
        : sendResponse(false)
    )
    await mount({ sendRequest } as unknown as RpcClient)

    await act(async () => {
      await actions!.createTerminalAndSend([COMMENT]).catch(() => {})
    })

    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Terminal input is locked'))
    const sheetUpdater = setSendSheet.mock.calls.find(
      ([value]) => typeof value === 'function'
    )?.[0] as ((current: unknown) => unknown) | undefined
    expect(sheetUpdater?.({ kind: 'ready', terminals: [] })).toEqual({
      kind: 'ready',
      terminals: [{ id: 'tab-1', title: 'Terminal', terminal: 'terminal-1' }]
    })
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'session.tabs.createTerminal')
    ).toHaveLength(1)
  })

  it('does not let a stale create send notes or release a new scope send lock', async () => {
    const oldCreation = deferred<unknown>()
    const newCreation = deferred<unknown>()
    const oldSendRequest = vi.fn((method: string) =>
      method === 'session.tabs.createTerminal'
        ? oldCreation.promise
        : Promise.resolve(sendResponse(true))
    )
    const newSendRequest = vi.fn((method: string) =>
      method === 'session.tabs.createTerminal'
        ? newCreation.promise
        : Promise.resolve(sendResponse(true))
    )
    await mount({ sendRequest: oldSendRequest } as unknown as RpcClient)

    const oldActions = actions!
    let oldRun!: Promise<void>
    act(() => {
      oldRun = oldActions.createTerminalAndSend([COMMENT])
    })
    await act(async () => {
      mountedClient = { sendRequest: newSendRequest } as unknown as RpcClient
      mountedWorktreeId = 'wt-2'
      renderer?.update(createElement(Harness))
    })
    let newRun!: Promise<void>
    act(() => {
      newRun = actions!.createTerminalAndSend([COMMENT])
      void oldActions.createTerminalAndSend([COMMENT])
    })

    await act(async () => {
      oldCreation.resolve({
        ok: true,
        result: { tab: { id: 'old-tab', type: 'terminal', terminal: 'old-terminal' } }
      })
      await oldRun
    })
    expect(oldSendRequest.mock.calls.filter(([method]) => method === 'terminal.send')).toHaveLength(
      0
    )
    act(() => {
      void actions!.createTerminalAndSend([COMMENT])
    })
    expect(
      newSendRequest.mock.calls.filter(([method]) => method === 'session.tabs.createTerminal')
    ).toHaveLength(1)

    await act(async () => {
      newCreation.resolve({
        ok: true,
        result: { tab: { id: 'new-tab', type: 'terminal', terminal: 'new-terminal' } }
      })
      await newRun
    })
    expect(newSendRequest.mock.calls.filter(([method]) => method === 'terminal.send')).toHaveLength(
      1
    )
  })

  it('releases the rendered busy state after returning to an in-flight send scope', async () => {
    const sending = deferred<unknown>()
    const client = { sendRequest: vi.fn(() => sending.promise) } as unknown as RpcClient
    await mount(client)
    let pending!: Promise<void>
    await act(async () => {
      pending = actions!.sendPromptToTerminal('terminal-1', [COMMENT])
    })
    await act(async () => {
      mountedWorktreeId = 'wt-2'
      renderer?.update(createElement(Harness))
    })
    await act(async () => {
      mountedWorktreeId = 'wt-1'
      renderer?.update(createElement(Harness))
    })
    expect(actions?.sendBusy).toBe(true)
    await act(async () => {
      sending.resolve(sendResponse(true))
      await pending
    })
    expect(actions?.sendBusy).toBe(false)
  })
})
