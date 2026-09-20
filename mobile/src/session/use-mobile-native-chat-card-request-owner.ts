import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'

type CardRequestOwner = {
  isCurrent: (terminal: string | null) => boolean
  canSend: (terminal: string | null, allowDisabled?: boolean) => boolean
}

/** A settled response belongs to its request even after input stops being sendable. */
export function useMobileNativeChatCardRequestOwner(args: {
  client: RpcClient | null
  enabled: boolean
  streamIdentity: string
  requestIdentity?: string | null
  handleRef: MutableRefObject<string | null>
}): CardRequestOwner {
  const { client, enabled, streamIdentity, requestIdentity, handleRef } = args
  const requestOwner = useMemo(
    () => ({ client, streamIdentity, requestIdentity }),
    [client, streamIdentity, requestIdentity]
  )
  const inputOwner = useMemo(() => ({ requestOwner, enabled }), [requestOwner, enabled])
  const committedRef = useRef<{
    requestOwner: typeof requestOwner
    inputOwner: typeof inputOwner
  } | null>(null)
  useLayoutEffect(() => {
    const committed = { requestOwner, inputOwner }
    committedRef.current = committed
    return () => {
      if (committedRef.current === committed) {
        committedRef.current = null
      }
    }
  }, [requestOwner, inputOwner])
  const isCurrent = (terminal: string | null): boolean =>
    committedRef.current?.requestOwner === requestOwner && handleRef.current === terminal
  const canSend = (terminal: string | null, allowDisabled = false): boolean =>
    committedRef.current?.inputOwner === inputOwner &&
    handleRef.current === terminal &&
    (enabled || allowDisabled)
  return { isCurrent, canSend }
}
