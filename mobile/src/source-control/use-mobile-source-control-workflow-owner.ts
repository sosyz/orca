import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

type Params = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  mountedRef: MutableRefObject<boolean>
  busyActionRef: MutableRefObject<string | null>
  setBusyAction: (next: string | null) => void
}
export type MobileSourceControlBusyClaim = { actionId: string; scopeKey: string }

export function useMobileSourceControlWorkflowOwner({
  client,
  connState,
  hostId,
  worktreeId,
  mountedRef,
  busyActionRef,
  setBusyAction
}: Params) {
  const scopeKey = `${hostId}\0${worktreeId}`
  const owner = useMemo(() => ({ client, connState, scopeKey }), [client, connState, scopeKey])
  const currentOwnerRef = useRef<typeof owner | null>(null)
  const lastScopeRef = useRef(scopeKey)
  const busyClaimRef = useRef<MobileSourceControlBusyClaim | null>(null)
  useLayoutEffect(() => {
    if (lastScopeRef.current !== scopeKey) {
      lastScopeRef.current = scopeKey
      busyClaimRef.current = null
      busyActionRef.current = null
      setBusyAction(null)
    }
    currentOwnerRef.current = owner
    return () => {
      if (currentOwnerRef.current === owner) {
        currentOwnerRef.current = null
      }
    }
  }, [busyActionRef, owner, scopeKey, setBusyAction])
  const isCurrentOwner = useCallback(
    () =>
      mountedRef.current &&
      currentOwnerRef.current === owner &&
      client !== null &&
      connState === 'connected',
    [client, connState, mountedRef, owner]
  )
  const claimBusy = useCallback(
    (actionId: string): MobileSourceControlBusyClaim | null => {
      if (!isCurrentOwner() || busyActionRef.current) {
        return null
      }
      const claim = { actionId, scopeKey }
      busyClaimRef.current = claim
      busyActionRef.current = actionId
      setBusyAction(actionId)
      return claim
    },
    [busyActionRef, isCurrentOwner, scopeKey, setBusyAction]
  )
  const releaseBusy = useCallback(
    (claim: MobileSourceControlBusyClaim) => {
      if (busyClaimRef.current !== claim) {
        return
      }
      busyClaimRef.current = null
      if (busyActionRef.current === claim.actionId) {
        busyActionRef.current = null
        if (mountedRef.current && lastScopeRef.current === claim.scopeKey) {
          setBusyAction(null)
        }
      }
    },
    [busyActionRef, mountedRef, setBusyAction]
  )
  return { isCurrentOwner, claimBusy, releaseBusy }
}
