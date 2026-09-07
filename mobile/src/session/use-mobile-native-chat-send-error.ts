import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import {
  clearMobileNativeChatSendError,
  readMobileNativeChatSendError,
  recordMobileNativeChatSendError,
  startMobileNativeChatSendErrorDisplay,
  useMobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'

const NATIVE_CHAT_SEND_ERROR_HOLD_MS = 4000
const NATIVE_CHAT_SEND_ERROR_TOAST_MS = 1600

/** Holds the newest native-chat send failure for the composer's inline banner.
 *  Why a banner and not the bottom toast: chat failures happen with the keyboard
 *  up, which covers the toast — the surface the user is looking at is the composer.
 *  Scoped like drafts and image chips: a failure belongs to the terminal it was
 *  raised on and must not follow the user to another tab. */
export function useMobileNativeChatSendError(args: {
  scopeKey: string | null
  showToast: (message: string, durationMs?: number) => void
}): {
  message: string | null
  show: (message: string) => void
  clear: () => void
  /** Set by the route each render; gates banner vs toast. */
  bannerMountedRef: MutableRefObject<boolean>
} {
  const bannerMountedRef = useRef(false)
  const mountedRef = useRef(false)
  const lastDisplayKeyRef = useRef<string | null>(null)
  const showToastRef = useRef(args.showToast)
  showToastRef.current = args.showToast
  // Why: `show`/`clear` are handed to sends that resolve much later (a 20s
  // unconfirmed send, a paced answer). Comparing the scope they were built for
  // against the live one is what stops tab A's late outcome from painting — or
  // wiping — tab B's banner.
  const liveScopeRef = useRef(args.scopeKey)
  liveScopeRef.current = args.scopeKey
  const scopeKey = args.scopeKey
  const scopeToken = useMobileNativeChatRuntimeScopeToken(scopeKey)
  const error = readMobileNativeChatSendError(scopeKey)
  const clear = useCallback(() => {
    if (!scopeToken || (mountedRef.current && liveScopeRef.current !== scopeToken.scopeKey)) {
      return
    }
    clearMobileNativeChatSendError(scopeToken)
  }, [scopeToken])
  const show = useCallback(
    (next: string) => {
      if (!scopeToken) {
        if (mountedRef.current) {
          showToastRef.current(next, NATIVE_CHAT_SEND_ERROR_TOAST_MS)
        }
        return
      }
      if (!mountedRef.current) {
        recordMobileNativeChatSendError(scopeToken, next)
        return
      }
      // Why: deferred failures can land after the user left chat (banner unmounted)
      // or moved to another tab, where the banner belongs to a different terminal —
      // both must fall back to the toast instead of being swallowed or misattributed.
      if (liveScopeRef.current !== scopeToken.scopeKey || !bannerMountedRef.current) {
        showToastRef.current(next, NATIVE_CHAT_SEND_ERROR_TOAST_MS)
        return
      }
      recordMobileNativeChatSendError(scopeToken, next)
    },
    [scopeToken]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      bannerMountedRef.current = false
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!scopeToken || !error) {
      lastDisplayKeyRef.current = null
      return
    }
    const mode = bannerMountedRef.current ? 'banner' : 'toast'
    const displayKey = `${scopeToken.scopeKey}:${scopeToken.generation}:${error.id}:${mode}`
    if (lastDisplayKeyRef.current === displayKey) {
      return
    }
    lastDisplayKeyRef.current = displayKey
    if (bannerMountedRef.current) {
      startMobileNativeChatSendErrorDisplay(scopeToken, error.id, NATIVE_CHAT_SEND_ERROR_HOLD_MS)
      return
    }
    showToastRef.current(error.message, NATIVE_CHAT_SEND_ERROR_TOAST_MS)
    clearMobileNativeChatSendError(scopeToken, error.id)
  })

  return { message: error?.message ?? null, show, clear, bannerMountedRef }
}
