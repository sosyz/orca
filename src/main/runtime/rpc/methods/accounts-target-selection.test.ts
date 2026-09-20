import { describe, expect, it, vi } from 'vitest'
import { ClaudeAccountSelection } from '../../../claude-accounts/claude-account-selection'
import { OrcaRuntimeService } from '../../orca-runtime'
import { isStreamingMethod } from '../core'
import { ACCOUNT_METHODS } from './accounts'

function selectionHarness() {
  let settings = {
    claudeManagedAccounts: ['host', 'Ubuntu', 'Debian'].map((runtime) => ({
      id: runtime,
      email: `${runtime}@example.test`,
      managedAuthRuntime: runtime === 'host' ? 'host' : 'wsl',
      wslDistro: runtime === 'host' ? null : runtime,
      updatedAt: 1
    })),
    activeClaudeManagedAccountId: 'host',
    activeClaudeManagedAccountIdsByRuntime: {
      host: 'host',
      wsl: { Ubuntu: 'Ubuntu', Debian: 'Debian' }
    }
  }
  const syncForCurrentSelection = vi.fn(async () => {})
  const forceMaterializeCurrentSelectionForRollback = vi.fn(async () => {})
  const refreshForClaudeAccountChange = vi.fn(async () => {})
  const selection = new ClaudeAccountSelection(
    {
      getSettings: () => settings,
      updateSettings: (patch: Partial<typeof settings>) => {
        settings = { ...settings, ...patch }
      }
    } as never,
    { refreshForClaudeAccountChange } as never,
    { syncForCurrentSelection, forceMaterializeCurrentSelectionForRollback } as never,
    async () => {}
  )
  const runtime = Object.create(OrcaRuntimeService.prototype) as OrcaRuntimeService
  Object.assign(runtime, {
    accountServices: {
      claudeAccounts: {
        selectAccount: selection.select.bind(selection),
        selectAccountForTarget: selection.select.bind(selection)
      }
    }
  })
  async function dispatch(name: string, params: unknown) {
    const method = ACCOUNT_METHODS.find((candidate) => candidate.name === name)
    if (!method || isStreamingMethod(method)) {
      throw new Error(`Missing request method: ${name}`)
    }
    return method.handler(method.params?.parse(params), { runtime, clientKind: 'mobile' })
  }
  return {
    settings: () => settings,
    dispatch,
    syncForCurrentSelection,
    refreshForClaudeAccountChange,
    forceMaterializeCurrentSelectionForRollback
  }
}

describe('Claude target selection through the account RPC and runtime', () => {
  it('clears Ubuntu without changing the host or Debian selection', async () => {
    const harness = selectionHarness()
    const target = { runtime: 'wsl', wslDistro: 'Ubuntu' }

    await harness.dispatch('accounts.selectClaudeForTarget', { accountId: null, target })

    expect(harness.settings().activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'host',
      wsl: { Ubuntu: null, Debian: 'Debian' }
    })
    expect(harness.settings().activeClaudeManagedAccountId).toBe('host')
    expect(harness.syncForCurrentSelection).toHaveBeenCalledWith(target)
    expect(harness.refreshForClaudeAccountChange).toHaveBeenCalledWith('Ubuntu', target)
  })

  it('preserves the explicit null-distro contract of clearing all WSL slots', async () => {
    const harness = selectionHarness()
    await harness.dispatch('accounts.selectClaudeForTarget', {
      accountId: null,
      target: { runtime: 'wsl', wslDistro: null }
    })
    expect(harness.settings().activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'host',
      wsl: { Ubuntu: null, Debian: null }
    })
  })

  it.each(['accounts.selectClaude', 'accounts.selectClaudeForTarget'])(
    'keeps %s host defaults isolated from WSL',
    async (method) => {
      const harness = selectionHarness()
      await harness.dispatch(method, {
        accountId: null,
        target: { runtime: 'host', wslDistro: null }
      })
      expect(harness.settings().activeClaudeManagedAccountIdsByRuntime).toEqual({
        host: null,
        wsl: { Ubuntu: 'Ubuntu', Debian: 'Debian' }
      })
    }
  )

  it('rejects a named account from another target before changing any selection', async () => {
    const harness = selectionHarness()
    const before = harness.settings()
    await expect(
      harness.dispatch('accounts.selectClaudeForTarget', {
        accountId: 'Debian',
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
    ).rejects.toThrow('That Claude account belongs to a different runtime.')
    expect(harness.settings()).toBe(before)
    expect(harness.syncForCurrentSelection).not.toHaveBeenCalled()
  })

  it('rolls back a failed runtime auth change without altering sibling slots', async () => {
    const harness = selectionHarness()
    const before = harness.settings()
    harness.syncForCurrentSelection.mockRejectedValueOnce(new Error('WSL unavailable'))
    await expect(
      harness.dispatch('accounts.selectClaudeForTarget', {
        accountId: null,
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
    ).rejects.toThrow('WSL unavailable')
    expect(harness.settings()).toEqual(before)
    expect(harness.refreshForClaudeAccountChange).not.toHaveBeenCalled()
    expect(harness.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalledOnce()
  })
})
