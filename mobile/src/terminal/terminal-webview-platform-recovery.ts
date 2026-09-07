import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import {
  shouldArmTerminalBridgeAutoRecovery,
  TERMINAL_HARMONY_BRIDGE_RECOVERY_MS,
  type TerminalWebViewPlatformPolicy
} from './terminal-webview-platform-policy'

type BooleanRef = { current: boolean }

type TerminalWebViewPlatformRecoveryOptions = {
  active: boolean
  generation: number
  platformPolicy: TerminalWebViewPlatformPolicy
  isBridgeReadyRef: BooleanRef
  isWebReadyRef: BooleanRef
  clearEngineError: () => void
  clearWebReadyWatchdog: () => void
  clearPendingMessages: () => void
  clearPendingWrites: () => void
  reloadNativeWebView: () => void
  remountWebViewSurface: () => void
  settlePendingOperations: () => void
}

export function useTerminalWebViewPlatformRecovery({
  active,
  generation,
  platformPolicy,
  isBridgeReadyRef,
  isWebReadyRef,
  clearEngineError,
  clearWebReadyWatchdog,
  clearPendingMessages,
  clearPendingWrites,
  reloadNativeWebView,
  remountWebViewSurface,
  settlePendingOperations
}: TerminalWebViewPlatformRecoveryOptions) {
  const bridgeAutoRecoveryAttemptedRef = useRef(false)
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState)

  const prepareSurfaceRemount = useCallback(() => {
    isBridgeReadyRef.current = false
    isWebReadyRef.current = false
    settlePendingOperations()
    clearPendingMessages()
    clearPendingWrites()
    clearWebReadyWatchdog()
    clearEngineError()
    remountWebViewSurface()
  }, [
    clearEngineError,
    clearPendingMessages,
    clearPendingWrites,
    clearWebReadyWatchdog,
    isBridgeReadyRef,
    isWebReadyRef,
    remountWebViewSurface,
    settlePendingOperations
  ])

  useEffect(() => {
    if (platformPolicy.bridgeAutoRecovery === 'none') {
      return
    }
    setAppState(AppState.currentState)
    const sub = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState)
    })
    return () => sub.remove()
  }, [platformPolicy.bridgeAutoRecovery])

  useEffect(() => {
    if (
      !shouldArmTerminalBridgeAutoRecovery({
        active,
        appState,
        policy: platformPolicy
      })
    ) {
      return
    }
    const timer = setTimeout(() => {
      if (
        !shouldArmTerminalBridgeAutoRecovery({
          active,
          appState: AppState.currentState,
          policy: platformPolicy
        })
      ) {
        return
      }
      if (isWebReadyRef.current || bridgeAutoRecoveryAttemptedRef.current) {
        return
      }
      // ArkWeb can create the document during navigation before its RN proxy is attached.
      bridgeAutoRecoveryAttemptedRef.current = true
      prepareSurfaceRemount()
    }, TERMINAL_HARMONY_BRIDGE_RECOVERY_MS)
    return () => clearTimeout(timer)
  }, [
    active,
    appState,
    generation,
    isBridgeReadyRef,
    isWebReadyRef,
    platformPolicy,
    prepareSurfaceRemount
  ])

  return useCallback(() => {
    clearEngineError()
    if (platformPolicy.reloadStrategy === 'native-reload') {
      reloadNativeWebView()
      return
    }
    bridgeAutoRecoveryAttemptedRef.current = false
    prepareSurfaceRemount()
  }, [clearEngineError, platformPolicy, prepareSurfaceRemount, reloadNativeWebView])
}
