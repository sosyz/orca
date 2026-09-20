import { describe, expect, it } from 'vitest'
import type { AccountsSnapshot } from './accounts-snapshot'
import type { ProviderKey } from './account-usage-state'
import { getMobileAccountDisplayActiveId } from './mobile-account-display-selection'

function snapshot(provider: ProviderKey, target: 'host' | 'wsl'): AccountsSnapshot {
  const selection = {
    activeAccountId: `${provider}-host`,
    activeAccountIdsByRuntime: {
      host: `${provider}-host`,
      wsl: { Ubuntu: `${provider}-wsl`, Debian: null }
    }
  }
  return {
    claude: selection,
    codex: selection,
    rateLimits: {
      claudeTarget: { runtime: target, wslDistro: target === 'wsl' ? 'Ubuntu' : null },
      codexTarget: { runtime: target, wslDistro: target === 'wsl' ? 'Ubuntu' : null }
    }
  } as AccountsSnapshot
}

describe('getMobileAccountDisplayActiveId', () => {
  it.each(['claude', 'codex'] as const)(
    'uses the %s usage runtime rather than the host account',
    (provider) => {
      expect(getMobileAccountDisplayActiveId(snapshot(provider, 'wsl'), provider)).toBe(
        `${provider}-wsl`
      )
      expect(getMobileAccountDisplayActiveId(snapshot(provider, 'host'), provider)).toBe(
        `${provider}-host`
      )
    }
  )

  it.each(['claude', 'codex'] as const)(
    'shows %s WSL system default when its slot is empty',
    (provider) => {
      const state = snapshot(provider, 'wsl')
      state.rateLimits[provider === 'claude' ? 'claudeTarget' : 'codexTarget'] = {
        runtime: 'wsl',
        wslDistro: 'Debian'
      }
      expect(getMobileAccountDisplayActiveId(state, provider)).toBeNull()
    }
  )

  it.each(['claude', 'codex'] as const)(
    'keeps the %s legacy active ID when the runtime map is absent',
    (provider) => {
      const state = snapshot(provider, 'wsl')
      delete state[provider].activeAccountIdsByRuntime
      expect(getMobileAccountDisplayActiveId(state, provider)).toBe(`${provider}-host`)
    }
  )
})
