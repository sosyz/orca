import { getProviderAccountActiveIdForView } from '../../../src/shared/provider-account-runtime-selection'
import type { AccountsSnapshot } from './accounts-snapshot'
import type { ProviderKey } from './account-usage-state'

export function getMobileAccountDisplayActiveId(
  snapshot: AccountsSnapshot,
  provider: ProviderKey
): string | null {
  const selection = snapshot[provider]
  const target = snapshot.rateLimits[provider === 'claude' ? 'claudeTarget' : 'codexTarget']
  // Legacy snapshots only had one active account and always attributed usage to it.
  if (!selection.activeAccountIdsByRuntime) {
    return selection.activeAccountId
  }
  return getProviderAccountActiveIdForView(selection, target)
}
