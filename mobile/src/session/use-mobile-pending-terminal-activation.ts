import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import { activateMobileSessionTab } from './mobile-session-tab-activation'

type Args = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  activeSessionTab: MobileSessionTab | null
  isCurrentSource: () => boolean
  isCurrentDocumentScope: () => boolean
  applySessionTabs: (result: SessionTabsResult) => unknown
  fetchSessionTabs: () => Promise<void>
  scheduleDelayedAction: (action: () => void, delayMs: number) => void
}

type ActivationTarget = { tabId: string; leafId?: string } | null

type ActivationAttempt = {
  target: ActivationTarget
  isCurrent: () => boolean
}

export function useMobilePendingTerminalActivation(args: Args): void {
  const terminalTab = args.activeSessionTab?.type === 'terminal' ? args.activeSessionTab : null
  const tabId = terminalTab?.id
  const leafId = terminalTab?.leafId
  const target = useMemo<ActivationTarget>(
    () => (tabId ? { tabId, leafId } : null),
    [tabId, leafId]
  )
  const committedTargetRef = useRef<ActivationTarget>(null)
  const attemptRef = useRef<ActivationAttempt | null>(null)
  useLayoutEffect(() => {
    committedTargetRef.current = target
    return () => {
      if (committedTargetRef.current === target) {
        committedTargetRef.current = null
      }
    }
  }, [target])

  const ready = typeof terminalTab?.terminal === 'string'
  useLayoutEffect(() => {
    if (ready) {
      attemptRef.current = null
    }
  }, [ready])

  useEffect(() => {
    const { client, connState, worktreeId } = args
    if (!client || connState !== 'connected' || !target || ready) {
      return
    }
    const isCurrent = () =>
      committedTargetRef.current === target &&
      args.isCurrentSource() &&
      args.isCurrentDocumentScope()
    if (!isCurrent()) {
      return
    }
    if (attemptRef.current?.target === target && attemptRef.current.isCurrent()) {
      return
    }
    const attempt = { target, isCurrent }
    attemptRef.current = attempt
    const isCurrentAttempt = () => attemptRef.current === attempt && isCurrent()
    const clearAttempt = () => {
      if (attemptRef.current === attempt) {
        attemptRef.current = null
      }
    }
    void activateMobileSessionTab(
      client,
      {
        worktree: `id:${worktreeId}`,
        tabId: target.tabId,
        leafId: target.leafId,
        notifyClients: false,
        navigation: 'caller',
        intent: 'user'
      },
      { isCurrent: isCurrentAttempt }
    )
      .then((response) => {
        if (!isCurrentAttempt()) {
          return
        }
        if (!response.ok) {
          clearAttempt()
          return
        }
        args.applySessionTabs(response.result as SessionTabsResult)
        for (const delay of [300, 1200]) {
          args.scheduleDelayedAction(() => {
            if (isCurrent()) {
              void args.fetchSessionTabs()
            }
          }, delay)
        }
      })
      .catch(clearAttempt)
  }, [args, target, ready])
}
