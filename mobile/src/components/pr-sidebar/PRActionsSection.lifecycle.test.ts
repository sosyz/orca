import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../../src/shared/github/pull-request-types'
import type { RpcClient } from '../../transport/rpc-client'
import type { ConnectionState } from '../../transport/types'
import { useMobilePrActions, type MobilePrActions } from '../../session/use-mobile-pr-actions'
import { PRActionsSection } from './PRActionsSection'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ GitMerge: 'GitMerge', Link2Off: 'Link2Off' }))
vi.mock('../ConfirmModal', () => ({ ConfirmModal: 'ConfirmModal' }))
vi.mock('./pr-actions-styles', () => ({ prActionsStyles: {} }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const OK = { id: 'ok', ok: true, result: { ok: true } }
const repo = { owner: 'org', repo: 'project', host: 'github.example.com' }
let renderer: ReactTestRenderer | null = null
function mount(sendRequest: ReturnType<typeof vi.fn>) {
  let client = { sendRequest } as unknown as RpcClient
  let pr = { number: 7, state: 'open', prRepo: repo } as PRInfo
  let worktreeId = 'repo::worktree'
  let connState: ConnectionState = 'connected'
  let actions!: MobilePrActions
  let refetch = vi.fn()
  function Probe() {
    actions = useMobilePrActions({
      client,
      connState,
      worktreeId,
      prNumber: pr.number,
      prRepo: pr.prRepo,
      refetch
    })
    return createElement(PRActionsSection, { pr, actions, client, worktreeId, onUnlinked: refetch })
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return {
    get actions() {
      return actions
    },
    get refetch() {
      return refetch
    },
    get confirm() {
      return renderer!.root.findByType('ConfirmModal')
    },
    pressMerge() {
      act(() =>
        renderer!.root.findByProps({ accessibilityLabel: 'Merge pull request' }).props.onPress()
      )
    },
    update(change: 'pr' | 'client' | 'worktree' | 'repo' | 'refresh' | 'disconnect') {
      if (change === 'pr') {
        pr = { ...pr, number: pr.number === 7 ? 8 : 7 }
      }
      if (change === 'client') {
        client = { sendRequest } as unknown as RpcClient
      }
      if (change === 'worktree') {
        worktreeId = 'repo::other'
      }
      if (change === 'repo') {
        pr = { ...pr, prRepo: { ...repo, host: 'another.example.com' } }
      }
      if (change === 'refresh') {
        pr = { ...pr, prRepo: { ...repo } }
      }
      if (change === 'disconnect') {
        connState = 'reconnecting'
      }
      refetch = vi.fn()
      act(() => renderer?.update(createElement(Probe)))
    }
  }
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('PR confirmation ownership', () => {
  it('does not duplicate a pending merge on double-confirm or return to the same PR', async () => {
    const pending = deferred<unknown>()
    const sendRequest = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(OK)
    const current = mount(sendRequest)
    current.pressMerge()
    const confirm = current.confirm.props.onConfirm
    act(() => {
      confirm()
      confirm()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    current.update('pr')
    current.update('pr')
    expect(current.actions.isBusy({ kind: 'merge' })).toBe(true)
    act(() => current.actions.merge())
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(OK)
    })
    expect(current.actions.isBusy({ kind: 'merge' })).toBe(false)
    await act(async () => {
      current.actions.merge()
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('does not queue an old connected confirmation after disconnect', async () => {
    const sendRequest = vi.fn().mockResolvedValue(OK)
    const current = mount(sendRequest)
    current.pressMerge()
    const confirm = current.confirm.props.onConfirm
    current.update('disconnect')
    await act(async () => {
      confirm()
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('preserves the confirmation across an equivalent PR refresh', async () => {
    const sendRequest = vi.fn().mockResolvedValue(OK)
    const current = mount(sendRequest)
    current.pressMerge()
    current.update('refresh')
    expect(current.confirm.props.visible).toBe(true)
    await act(async () => {
      current.confirm.props.onConfirm()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(current.refetch).toHaveBeenCalledTimes(1)
  })

  it('does not revive an old confirmation or optimistic receipt after switching away and back', async () => {
    const pending = deferred<unknown>()
    const sendRequest = vi.fn(() => pending.promise)
    const current = mount(sendRequest)
    current.pressMerge()
    const oldConfirm = current.confirm.props.onConfirm
    act(() => current.actions.setAutoMerge(true))
    current.update('pr')
    current.update('pr')
    expect(current.actions.resolveAutoMerge(false)).toBe(false)
    await act(async () => {
      oldConfirm()
      pending.resolve({ id: 'old', ok: true, result: { ok: false, error: 'HTTP 403: forbidden' } })
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(current.actions.blocked).toBeNull()
    expect(current.actions.busy).toBeNull()
    expect(current.refetch).not.toHaveBeenCalled()
  })

  it('does not clear the new source busy state when an old request finishes', async () => {
    const old = deferred<unknown>()
    const next = deferred<unknown>()
    const sendRequest = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const current = mount(sendRequest)
    act(() => current.actions.merge())
    current.update('pr')
    act(() => current.actions.merge())
    await act(async () => {
      old.resolve(OK)
    })
    expect(current.actions.busy).toEqual({ kind: 'merge' })
    expect(current.refetch).not.toHaveBeenCalled()
    await act(async () => {
      next.resolve(OK)
    })
    expect(current.actions.busy).toBeNull()
    expect(current.refetch).toHaveBeenCalledTimes(1)
  })

  it.each(['pr', 'client', 'worktree', 'repo'] as const)(
    'retires a confirmation when %s changes',
    async (change) => {
      const sendRequest = vi.fn().mockResolvedValue(OK)
      const current = mount(sendRequest)
      current.pressMerge()
      const oldConfirm = current.confirm.props.onConfirm
      expect(current.confirm.props.visible).toBe(true)
      current.update(change)
      await act(async () => {
        oldConfirm()
      })
      expect(sendRequest).not.toHaveBeenCalled()
      expect(current.confirm.props.visible).toBe(false)
      current.pressMerge()
      await act(async () => {
        current.confirm.props.onConfirm()
      })
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(sendRequest).toHaveBeenCalledWith(
        'github.mergePR',
        expect.objectContaining({
          prNumber: change === 'pr' ? 8 : 7,
          prRepo: change === 'repo' ? { ...repo, host: 'another.example.com' } : repo
        })
      )
    }
  )

  it('does not invoke a captured confirmation after unmount', async () => {
    const sendRequest = vi.fn().mockResolvedValue(OK)
    const current = mount(sendRequest)
    current.pressMerge()
    const confirm = current.confirm.props.onConfirm
    act(() => renderer?.unmount())
    await act(async () => {
      confirm()
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'does not apply an old client receipt to the current PR: success=%s',
    async (success) => {
      const pending = deferred<unknown>()
      const sendRequest = vi.fn(() => pending.promise)
      const current = mount(sendRequest)
      act(() => current.actions.merge())
      current.update('client')
      expect(current.actions.busy).toBeNull()
      await act(async () => {
        pending.resolve(
          success
            ? OK
            : {
                id: 'old',
                ok: true,
                result: { ok: false, error: 'old client denied' }
              }
        )
      })
      expect(current.actions.error).toBeNull()
      expect(current.actions.blocked).toBeNull()
      expect(current.refetch).not.toHaveBeenCalled()
    }
  )
})
