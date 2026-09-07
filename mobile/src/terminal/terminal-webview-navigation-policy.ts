const LOCAL_TERMINAL_URL_PREFIXES = ['data:', 'blob:'] as const

export function isTerminalWebViewNavigationAllowed(url: string): boolean {
  return (
    url === 'about:blank' || LOCAL_TERMINAL_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
  )
}
