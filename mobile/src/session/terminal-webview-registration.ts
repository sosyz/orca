import type { MutableRefObject } from 'react'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import type {
  TerminalGestureInputBucket,
  TerminalGestureInputQueue
} from './mobile-session-route-types'

type TerminalWebViewRegistrationRefs = {
  initializedHandlesRef: MutableRefObject<Set<string>>
  leaseOnlyHandlesRef: MutableRefObject<Set<string>>
  subscribingHandlesRef: MutableRefObject<Set<string>>
  terminalGestureInputBucketsRef: MutableRefObject<Map<string, TerminalGestureInputBucket>>
  terminalGestureInputInFlightRef: MutableRefObject<Set<string>>
  terminalGestureInputQueuesRef: MutableRefObject<Map<string, TerminalGestureInputQueue>>
  terminalRefs: MutableRefObject<Map<string, TerminalWebViewHandle>>
  terminalUnsubsRef: MutableRefObject<Map<string, () => void>>
  unsubscribeTerminal: (handle: string) => void
  webReadyHandlesRef: MutableRefObject<Set<string>>
}

function shouldUnsubscribeDetachedWebView(
  refs: TerminalWebViewRegistrationRefs,
  handle: string
): boolean {
  if (refs.leaseOnlyHandlesRef.current.has(handle)) {
    return false
  }
  return (
    refs.initializedHandlesRef.current.has(handle) ||
    refs.terminalUnsubsRef.current.has(handle) ||
    refs.subscribingHandlesRef.current.has(handle)
  )
}

export function setTerminalWebViewRegistration(
  refs: TerminalWebViewRegistrationRefs,
  handle: string,
  ref: TerminalWebViewHandle | null
): void {
  if (ref) {
    refs.terminalRefs.current.set(handle, ref)
    return
  }

  if (shouldUnsubscribeDetachedWebView(refs, handle)) {
    refs.unsubscribeTerminal(handle)
  }
  refs.terminalRefs.current.delete(handle)
  refs.webReadyHandlesRef.current.delete(handle)
  refs.initializedHandlesRef.current.delete(handle)
  refs.terminalGestureInputBucketsRef.current.delete(handle)
  const queued = refs.terminalGestureInputQueuesRef.current.get(handle)
  if (queued?.timer) {
    clearTimeout(queued.timer)
  }
  refs.terminalGestureInputQueuesRef.current.delete(handle)
  refs.terminalGestureInputInFlightRef.current.delete(handle)
}
