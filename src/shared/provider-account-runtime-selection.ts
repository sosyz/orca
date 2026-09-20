export type ProviderAccountRuntimeView = {
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
}

export type ProviderAccountSelection = {
  activeAccountId: string | null
  activeAccountIdsByRuntime?: {
    host: string | null
    wsl: Record<string, string | null>
  }
}

export const WSL_DEFAULT_DISTRO_KEY = '__default__'

export function getProviderAccountActiveIdForView(
  selection: ProviderAccountSelection,
  runtime: ProviderAccountRuntimeView
): string | null {
  if (runtime.runtime === 'host') {
    return selection.activeAccountIdsByRuntime?.host ?? selection.activeAccountId ?? null
  }
  if (runtime.wslDistro) {
    return selection.activeAccountIdsByRuntime?.wsl?.[runtime.wslDistro] ?? null
  }
  const wsl = selection.activeAccountIdsByRuntime?.wsl ?? {}
  if (wsl[WSL_DEFAULT_DISTRO_KEY]) {
    return wsl[WSL_DEFAULT_DISTRO_KEY]
  }
  const selectedIds = Array.from(new Set(Object.values(wsl).filter(Boolean)))
  return selectedIds.length === 1 ? selectedIds[0] : null
}
