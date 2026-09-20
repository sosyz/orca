import { describe, expect, it } from 'vitest'
import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/accounts-snapshot'
import {
  formatMobileAccountSelectionError,
  getMobileAccountSelectionRequest
} from './mobile-account-selection'

function snapshot(): AccountsSnapshot {
  return decodeAccountsSnapshot({
    claude: {
      accounts: [
        { id: 'claude-host', email: 'host@example.test', managedAuthRuntime: 'host' },
        {
          id: 'claude-ubuntu',
          email: 'ubuntu@example.test',
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu'
        }
      ],
      activeAccountId: 'claude-host',
      activeAccountIdsByRuntime: { host: 'claude-host', wsl: { Ubuntu: 'claude-ubuntu' } }
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      claudeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' },
      codexTarget: { runtime: 'wsl', wslDistro: 'Debian' },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  })
}

describe('mobile account selection requests', () => {
  it.each(['claude', 'codex'] as const)(
    'keeps %s system default on its published target',
    (provider) => {
      expect(getMobileAccountSelectionRequest(snapshot(), provider, null)).toEqual({
        method:
          provider === 'claude'
            ? 'accounts.selectClaudeForTarget'
            : 'accounts.selectCodexForTarget',
        params: {
          accountId: null,
          target: { runtime: 'wsl', wslDistro: provider === 'claude' ? 'Ubuntu' : 'Debian' }
        }
      })
    }
  )

  it('keeps a named Claude account on its own runtime when another target is displayed', () => {
    const value = snapshot()
    value.rateLimits.claudeTarget = { runtime: 'wsl', wslDistro: 'Debian' }
    expect(getMobileAccountSelectionRequest(value, 'claude', 'claude-ubuntu')).toEqual({
      method: 'accounts.selectClaudeForTarget',
      params: { accountId: 'claude-ubuntu', target: { runtime: 'wsl', wslDistro: 'Ubuntu' } }
    })
    expect(getMobileAccountSelectionRequest(value, 'claude', 'claude-host')).toEqual({
      method: 'accounts.selectClaude',
      params: { accountId: 'claude-host' }
    })
  })

  it.each(['claude', 'codex'] as const)(
    'preserves an explicitly published all-WSL %s target',
    (provider) => {
      const value = snapshot()
      value.rateLimits[provider === 'claude' ? 'claudeTarget' : 'codexTarget'] = {
        runtime: 'wsl',
        wslDistro: null
      }
      expect(getMobileAccountSelectionRequest(value, provider, null).params).toEqual({
        accountId: null,
        target: { runtime: 'wsl', wslDistro: null }
      })
    }
  )

  it.each(['claude', 'codex'] as const)(
    'retains the host-only method for legacy %s snapshots',
    (provider) => {
      const value = snapshot()
      const {
        claudeTarget: _claudeTarget,
        codexTarget: _codexTarget,
        ...rateLimits
      } = value.rateLimits
      const legacy = decodeAccountsSnapshot({ ...value, rateLimits })
      expect(getMobileAccountSelectionRequest(legacy, provider, null)).toEqual({
        method: provider === 'claude' ? 'accounts.selectClaude' : 'accounts.selectCodex',
        params: { accountId: null }
      })
    }
  )

  it('rejects a missing Claude account without constructing a host selection', () => {
    expect(() => getMobileAccountSelectionRequest(snapshot(), 'claude', 'removed')).toThrow(
      'That Claude account no longer exists.'
    )
  })

  it('retains Codex selection targeting instead of adopting Claude account metadata', () => {
    expect(getMobileAccountSelectionRequest(snapshot(), 'codex', 'codex-next')).toEqual({
      method: 'accounts.selectCodexForTarget',
      params: { accountId: 'codex-next', target: { runtime: 'wsl', wslDistro: 'Debian' } }
    })
  })

  it.each(['method_not_found', 'forbidden'])(
    'explains %s without replacing the target with host',
    (code) => {
      const request = getMobileAccountSelectionRequest(snapshot(), 'claude', null)
      expect(formatMobileAccountSelectionError(request, { code, message: 'Not available' })).toBe(
        'This host cannot switch Claude accounts for this runtime from mobile. Update Orca on the host or switch the account from desktop Settings.'
      )
      expect(request).toEqual({
        method: 'accounts.selectClaudeForTarget',
        params: { accountId: null, target: { runtime: 'wsl', wslDistro: 'Ubuntu' } }
      })
    }
  )

  it('preserves provider errors and host-only errors', () => {
    const wslRequest = getMobileAccountSelectionRequest(snapshot(), 'claude', null)
    const hostRequest = getMobileAccountSelectionRequest(snapshot(), 'claude', 'claude-host')
    expect(
      formatMobileAccountSelectionError(wslRequest, {
        code: 'internal_error',
        message: 'Cannot update the selected credentials'
      })
    ).toBe('Cannot update the selected credentials')
    expect(
      formatMobileAccountSelectionError(hostRequest, {
        code: 'forbidden',
        message: 'Device access revoked'
      })
    ).toBe('Device access revoked')
  })
})
