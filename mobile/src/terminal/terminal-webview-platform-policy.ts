export const TERMINAL_HARMONY_BRIDGE_RECOVERY_MS = 5000

export type TerminalWebViewMountStrategy = 'retain-hidden' | 'active-uncovered-only'
export type TerminalBridgeReadinessStrategy = 'direct' | 'native-ack-gated'
export type TerminalWebViewReloadStrategy = 'native-reload' | 'remount-surface'
export type TerminalForegroundRecoveryStrategy =
  | 'none'
  | 'probe-mounted-document'
  | 'remount-surface'
export type TerminalBridgeAutoRecoveryStrategy = 'none' | 'foreground-visible-once'
export type TerminalHiddenPanePresentation = 'opacity-hidden' | 'display-none'

export type TerminalWebViewPlatformPolicy = {
  mountStrategy: TerminalWebViewMountStrategy
  bridgeReadiness: TerminalBridgeReadinessStrategy
  webglEnabled: boolean
  reloadStrategy: TerminalWebViewReloadStrategy
  foregroundRecovery: TerminalForegroundRecoveryStrategy
  bridgeAutoRecovery: TerminalBridgeAutoRecoveryStrategy
  hiddenPanePresentation: TerminalHiddenPanePresentation
}

type TerminalPaneWebViewStateOptions = {
  active: boolean
  covered: boolean
  retained?: boolean
  platform: string
}

type TerminalPaneWebViewState = {
  webViewActive: boolean
  shouldMountWebView: boolean
  hiddenPanePresentation: TerminalHiddenPanePresentation
}

const RETAINED_WEBVIEW_POLICY: TerminalWebViewPlatformPolicy = {
  mountStrategy: 'retain-hidden',
  bridgeReadiness: 'direct',
  webglEnabled: true,
  reloadStrategy: 'native-reload',
  foregroundRecovery: 'none',
  bridgeAutoRecovery: 'none',
  hiddenPanePresentation: 'opacity-hidden'
}

const IOS_WEBVIEW_POLICY: TerminalWebViewPlatformPolicy = {
  ...RETAINED_WEBVIEW_POLICY,
  foregroundRecovery: 'probe-mounted-document'
}

const HARMONY_WEBVIEW_POLICY: TerminalWebViewPlatformPolicy = {
  mountStrategy: 'active-uncovered-only',
  bridgeReadiness: 'native-ack-gated',
  webglEnabled: false,
  reloadStrategy: 'remount-surface',
  foregroundRecovery: 'remount-surface',
  bridgeAutoRecovery: 'foreground-visible-once',
  hiddenPanePresentation: 'display-none'
}

export function getTerminalWebViewPlatformPolicy(platform: string): TerminalWebViewPlatformPolicy {
  if (platform === 'harmony') {
    return HARMONY_WEBVIEW_POLICY
  }
  if (platform === 'ios') {
    return IOS_WEBVIEW_POLICY
  }
  return RETAINED_WEBVIEW_POLICY
}

export function getTerminalPaneWebViewState({
  active,
  covered,
  retained = false,
  platform
}: TerminalPaneWebViewStateOptions): TerminalPaneWebViewState {
  const policy = getTerminalWebViewPlatformPolicy(platform)
  const webViewActive = active && !covered
  return {
    webViewActive,
    shouldMountWebView: policy.mountStrategy === 'retain-hidden' || webViewActive || retained,
    hiddenPanePresentation: policy.hiddenPanePresentation
  }
}

export function shouldRunTerminalForegroundRecovery(
  previousState: string | null | undefined,
  nextState: string,
  platform: string
): boolean {
  return (
    getTerminalWebViewPlatformPolicy(platform).foregroundRecovery !== 'none' &&
    nextState === 'active' &&
    (previousState === 'background' || previousState === 'inactive')
  )
}

export function shouldArmTerminalBridgeAutoRecovery({
  active,
  appState,
  policy
}: {
  active: boolean
  appState: string | null | undefined
  policy: TerminalWebViewPlatformPolicy
}): boolean {
  return policy.bridgeAutoRecovery === 'foreground-visible-once' && active && appState === 'active'
}
