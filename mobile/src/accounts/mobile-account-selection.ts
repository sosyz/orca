import type { ProviderKey } from '../components/account-usage-state'
import type { AccountsSnapshot, RateLimitRuntimeTarget } from '../components/accounts-snapshot'
import type { RpcFailure } from '../transport/types'

export type MobileAccountSelectionRequest =
  | {
      method: 'accounts.selectClaude' | 'accounts.selectCodex'
      params: { accountId: string | null }
    }
  | {
      method: 'accounts.selectClaudeForTarget' | 'accounts.selectCodexForTarget'
      params: { accountId: string | null; target: RateLimitRuntimeTarget }
    }

export function getMobileAccountSelectionRequest(
  snapshot: AccountsSnapshot,
  provider: ProviderKey,
  accountId: string | null
): MobileAccountSelectionRequest {
  let target =
    provider === 'claude' ? snapshot.rateLimits.claudeTarget : snapshot.rateLimits.codexTarget
  if (provider === 'claude' && accountId !== null) {
    const account = snapshot.claude.accounts.find((candidate) => candidate.id === accountId)
    if (!account) {
      throw new Error('That Claude account no longer exists.')
    }
    // A named Claude account owns its runtime; system default follows the displayed target.
    target = {
      runtime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null
    }
  }
  if (target.runtime === 'wsl') {
    return {
      method:
        provider === 'claude' ? 'accounts.selectClaudeForTarget' : 'accounts.selectCodexForTarget',
      params: { accountId, target }
    }
  }
  return {
    method: provider === 'claude' ? 'accounts.selectClaude' : 'accounts.selectCodex',
    params: { accountId }
  }
}

export function formatMobileAccountSelectionError(
  request: MobileAccountSelectionRequest,
  error: RpcFailure['error']
): string {
  if (
    'target' in request.params &&
    (error.code === 'method_not_found' || error.code === 'forbidden')
  ) {
    const provider = request.method === 'accounts.selectClaudeForTarget' ? 'Claude' : 'Codex'
    return `This host cannot switch ${provider} accounts for this runtime from mobile. Update Orca on the host or switch the account from desktop Settings.`
  }
  return error.message
}
