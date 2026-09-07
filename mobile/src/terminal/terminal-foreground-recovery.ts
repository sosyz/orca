import type { RefObject } from 'react'
import type { ConnectionState } from '../transport/types'
import type { TerminalWebViewHandle } from './terminal-webview-contract'
import { shouldRunTerminalForegroundRecovery } from './terminal-webview-platform-policy'

export const TERMINAL_FOREGROUND_RECOVERY_DELAY_MS = 120

// 'deferred' = the socket wasn't connected at the foreground edge (it usually
// dies after ~60-80s of background); the caller must re-run recovery once the
// connection is back or a blanked WKWebView stays stale until a tab switch.
export type TerminalForegroundRecoveryOutcome = 'recovered' | 'deferred' | 'skipped'

type TerminalForegroundRecoveryOptions = {
  activeHandleRef: RefObject<string | null>
  terminalRefs: RefObject<Map<string, TerminalWebViewHandle>>
  initializedHandlesRef: RefObject<Set<string>>
  connStateRef: RefObject<ConnectionState>
  unsubscribeTerminal: (handle: string) => void
  subscribeToTerminal: (handle: string) => void
  schedule: (fn: () => void, ms: number) => void
  delayMs?: number
}

export function shouldRecoverTerminalOnAppStateChange(
  previousState: string | null | undefined,
  nextState: string,
  platform: string
): boolean {
  return shouldRunTerminalForegroundRecovery(previousState, nextState, platform)
}

export function recoverActiveTerminalAfterForeground({
  activeHandleRef,
  terminalRefs,
  initializedHandlesRef,
  connStateRef,
  unsubscribeTerminal,
  subscribeToTerminal,
  schedule,
  delayMs = TERMINAL_FOREGROUND_RECOVERY_DELAY_MS
}: TerminalForegroundRecoveryOptions): TerminalForegroundRecoveryOutcome {
  if (connStateRef.current !== 'connected') {
    return 'deferred'
  }
  const handle = activeHandleRef.current
  const activeRef = handle ? terminalRefs.current.get(handle) : undefined
  const activeNeedsSurfaceRemount = activeRef?.foregroundRecovery === 'remount-surface'
  const shouldRecoverActive =
    !!handle &&
    !!activeRef &&
    (initializedHandlesRef.current.has(handle) || activeNeedsSurfaceRemount)
  const initializedMountedHandles: string[] = []
  for (const initializedHandle of initializedHandlesRef.current) {
    if (terminalRefs.current.has(initializedHandle)) {
      initializedMountedHandles.push(initializedHandle)
    }
  }
  if (initializedMountedHandles.length === 0 && !shouldRecoverActive) {
    return 'skipped'
  }

  // Why: any mounted terminal document covered by the platform foreground policy
  // must accept scrollback on next visibility instead of trusting stale pixels.
  for (const initializedHandle of initializedMountedHandles) {
    initializedHandlesRef.current.delete(initializedHandle)
  }

  if (!shouldRecoverActive || !handle) {
    return 'recovered'
  }

  unsubscribeTerminal(handle)
  if (activeNeedsSurfaceRemount) {
    if (activeHandleRef.current === handle && terminalRefs.current.has(handle)) {
      subscribeToTerminal(handle)
    }
    return 'recovered'
  }

  schedule(() => {
    if (connStateRef.current !== 'connected') {
      return
    }
    if (activeHandleRef.current !== handle || !terminalRefs.current.has(handle)) {
      return
    }
    subscribeToTerminal(handle)
  }, delayMs)
  return 'recovered'
}
