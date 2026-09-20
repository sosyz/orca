import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import {
  getProviderAccountActiveIdForView,
  type ProviderAccountSelection,
  type ProviderAccountRuntimeView
} from '../../../../shared/provider-account-runtime-selection'

export {
  getProviderAccountActiveIdForView,
  WSL_DEFAULT_DISTRO_KEY,
  type ProviderAccountRuntimeView
} from '../../../../shared/provider-account-runtime-selection'

type ProviderAccount =
  | ClaudeRateLimitAccountsState['accounts'][number]
  | CodexRateLimitAccountsState['accounts'][number]

export function getProviderAccountRuntime(account: ProviderAccount): {
  runtime: 'host' | 'wsl'
  wslDistro: string | null
} {
  const runtime =
    'authMethod' in account
      ? (account.managedAuthRuntime ?? 'host')
      : (account.managedHomeRuntime ?? 'host')
  return {
    runtime,
    wslDistro: account.wslDistro ?? null
  }
}

export function providerAccountMatchesView(
  account: ProviderAccount,
  runtime: ProviderAccountRuntimeView,
  options: {
    remoteOwner: boolean
    ownerPlatform: NodeJS.Platform | null
  }
): boolean {
  const accountView = getProviderAccountRuntime(account)

  if (options.remoteOwner) {
    // Why: provider accounts belong to the Orca runtime, not its client or a
    // downstream SSH host; a Windows runtime owns both host and WSL accounts.
    return options.ownerPlatform === 'win32' || accountView.runtime !== 'wsl'
  }
  if (runtime.runtime === 'host') {
    return accountView.runtime !== 'wsl'
  }
  if (accountView.runtime !== 'wsl') {
    return false
  }
  return runtime.wslDistro ? accountView.wslDistro === runtime.wslDistro : true
}

export function providerAccountIsActiveInView(
  account: ProviderAccount,
  selection: ProviderAccountSelection,
  runtime: ProviderAccountRuntimeView,
  options: {
    remoteOwner: boolean
  }
): boolean {
  if (options.remoteOwner) {
    // Why: remote Windows lists host and WSL accounts in one roster; Active must
    // follow each account's own runtime slot, not the forced host view filter.
    return (
      getProviderAccountActiveIdForView(selection, getProviderAccountRuntime(account)) ===
      account.id
    )
  }
  return getProviderAccountActiveIdForView(selection, runtime) === account.id
}
