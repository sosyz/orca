import type { MutableRefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import { setTerminalWebViewRegistration } from './terminal-webview-registration'

const HANDLE = 'terminal-1'
const WEB_VIEW_REF = { clear: vi.fn() } as unknown as TerminalWebViewHandle
const REPLACEMENT_REF = { clear: vi.fn() } as unknown as TerminalWebViewHandle

function mutableRef<T>(current: T): MutableRefObject<T> {
  return { current }
}

function registrationHarness() {
  const terminalUnsubscribe = vi.fn()
  const refs = {
    initializedHandlesRef: mutableRef(new Set<string>()),
    leaseOnlyHandlesRef: mutableRef(new Set<string>()),
    subscribingHandlesRef: mutableRef(new Set<string>()),
    terminalGestureInputBucketsRef: mutableRef(new Map()),
    terminalGestureInputInFlightRef: mutableRef(new Set<string>()),
    terminalGestureInputQueuesRef: mutableRef(new Map()),
    terminalRefs: mutableRef(new Map<string, TerminalWebViewHandle>()),
    terminalUnsubsRef: mutableRef(new Map<string, () => void>()),
    unsubscribeTerminal: vi.fn((handle: string) => {
      refs.terminalUnsubsRef.current.get(handle)?.()
      refs.terminalUnsubsRef.current.delete(handle)
      refs.subscribingHandlesRef.current.delete(handle)
      refs.leaseOnlyHandlesRef.current.delete(handle)
    }),
    webReadyHandlesRef: mutableRef(new Set<string>())
  }
  return {
    refs,
    terminalUnsubscribe,
    setRef: (ref: TerminalWebViewHandle | null) => setTerminalWebViewRegistration(refs, HANDLE, ref)
  }
}

describe('session terminal WebView registration', () => {
  it('stores mounted WebView refs without claiming readiness or subscriptions', () => {
    const { refs, setRef } = registrationHarness()

    setRef(WEB_VIEW_REF)

    expect(refs.terminalRefs.current.get(HANDLE)).toBe(WEB_VIEW_REF)
    expect(refs.webReadyHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.initializedHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.unsubscribeTerminal).not.toHaveBeenCalled()
  })

  it('detaches initialized WebViews by clearing view state and unsubscribing once', () => {
    const { refs, setRef, terminalUnsubscribe } = registrationHarness()
    refs.terminalRefs.current.set(HANDLE, WEB_VIEW_REF)
    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.initializedHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, terminalUnsubscribe)
    refs.terminalGestureInputBucketsRef.current.set(HANDLE, { tokens: 1, lastRefillMs: 0 })
    refs.terminalGestureInputQueuesRef.current.set(HANDLE, {
      bytes: '\x1b[A',
      lastUpdatedMs: 0,
      sequenceCount: 1,
      timer: null
    })
    refs.terminalGestureInputInFlightRef.current.add(HANDLE)

    setRef(null)
    setRef(null)

    expect(refs.unsubscribeTerminal).toHaveBeenCalledTimes(1)
    expect(terminalUnsubscribe).toHaveBeenCalledTimes(1)
    expect(refs.terminalRefs.current.has(HANDLE)).toBe(false)
    expect(refs.webReadyHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.initializedHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.terminalGestureInputBucketsRef.current.has(HANDLE)).toBe(false)
    expect(refs.terminalGestureInputQueuesRef.current.has(HANDLE)).toBe(false)
    expect(refs.terminalGestureInputInFlightRef.current.has(HANDLE)).toBe(false)
  })

  it('unsubscribes non-lease streams that detach before their first scrollback init', () => {
    const { refs, setRef, terminalUnsubscribe } = registrationHarness()
    refs.terminalRefs.current.set(HANDLE, WEB_VIEW_REF)
    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, terminalUnsubscribe)

    setRef(null)

    expect(refs.unsubscribeTerminal).toHaveBeenCalledWith(HANDLE)
    expect(refs.terminalUnsubsRef.current.has(HANDLE)).toBe(false)
    expect(refs.webReadyHandlesRef.current.has(HANDLE)).toBe(false)
  })

  it('invalidates non-lease subscribe-in-flight work when the WebView detaches', () => {
    const { refs, setRef } = registrationHarness()
    refs.terminalRefs.current.set(HANDLE, WEB_VIEW_REF)
    refs.subscribingHandlesRef.current.add(HANDLE)

    setRef(null)

    expect(refs.unsubscribeTerminal).toHaveBeenCalledWith(HANDLE)
    expect(refs.subscribingHandlesRef.current.has(HANDLE)).toBe(false)
  })

  it('preserves native-chat lease-only streams when their WebView ref is absent', () => {
    const { refs, setRef, terminalUnsubscribe } = registrationHarness()
    refs.terminalUnsubsRef.current.set(HANDLE, terminalUnsubscribe)
    refs.leaseOnlyHandlesRef.current.add(HANDLE)
    refs.webReadyHandlesRef.current.add(HANDLE)

    setRef(null)

    expect(refs.unsubscribeTerminal).not.toHaveBeenCalled()
    expect(refs.terminalUnsubsRef.current.get(HANDLE)).toBe(terminalUnsubscribe)
    expect(refs.leaseOnlyHandlesRef.current.has(HANDLE)).toBe(true)
    expect(refs.webReadyHandlesRef.current.has(HANDLE)).toBe(false)
  })

  it('reattaches without carrying old readiness and can own a later subscription', () => {
    const { refs, setRef } = registrationHarness()
    const firstUnsubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()
    refs.terminalRefs.current.set(HANDLE, WEB_VIEW_REF)
    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, firstUnsubscribe)

    setRef(null)
    setRef(REPLACEMENT_REF)

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1)
    expect(refs.terminalRefs.current.get(HANDLE)).toBe(REPLACEMENT_REF)
    expect(refs.webReadyHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.initializedHandlesRef.current.has(HANDLE)).toBe(false)
    expect(refs.terminalUnsubsRef.current.has(HANDLE)).toBe(false)

    refs.webReadyHandlesRef.current.add(HANDLE)
    refs.initializedHandlesRef.current.add(HANDLE)
    refs.terminalUnsubsRef.current.set(HANDLE, secondUnsubscribe)
    setRef(null)

    expect(secondUnsubscribe).toHaveBeenCalledTimes(1)
    expect(refs.unsubscribeTerminal).toHaveBeenCalledTimes(2)
  })
})
