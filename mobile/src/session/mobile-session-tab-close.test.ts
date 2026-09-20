import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { closeMobileSessionTabIfCurrent } from './mobile-session-tab-close'

describe('session tab close request ownership', () => {
  it('does not dispatch a delayed sheet action after the workspace changed', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true })
    expect(
      await closeMobileSessionTabIfCurrent({
        client: { sendRequest } as unknown as RpcClient,
        worktreeId: 'old-workspace',
        tabId: 'old-tab',
        isCurrent: () => false
      })
    ).toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('does not authorize clearing current documents when an old close succeeds late', async () => {
    let resolve!: (value: { ok: boolean }) => void
    const sendRequest = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((done) => {
          resolve = done
        })
    )
    let current = true
    const pending = closeMobileSessionTabIfCurrent({
      client: { sendRequest } as unknown as RpcClient,
      worktreeId: 'old-workspace',
      tabId: 'old-tab',
      isCurrent: () => current
    })
    current = false
    resolve({ ok: true })
    expect(await pending).toBe(false)
    expect(sendRequest).toHaveBeenCalledWith('session.tabs.close', {
      worktree: 'id:old-workspace',
      tabId: 'old-tab',
      reason: 'user'
    })
  })

  it.each(['accepted', 'rejected', 'throws'] as const)(
    'preserves the active close outcome: %s',
    async (outcome) => {
      const sendRequest = vi.fn(async () => {
        if (outcome === 'throws') {
          throw new Error('connection closed')
        }
        return { ok: outcome === 'accepted' }
      })
      expect(
        await closeMobileSessionTabIfCurrent({
          client: { sendRequest } as unknown as RpcClient,
          worktreeId: 'workspace',
          tabId: 'tab',
          isCurrent: () => true
        })
      ).toBe(outcome === 'accepted')
    }
  )
})
