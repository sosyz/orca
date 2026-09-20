import { useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

type TerminalCreationSource = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  connState: ConnectionState
}

export function useMobileTerminalCreationOwner(source: TerminalCreationSource) {
  const { client, hostId, worktreeId, connState } = source
  const owner = useMemo(
    () => ({ client, hostId, worktreeId, connState }),
    [client, hostId, worktreeId, connState]
  )
  const committed = useRef<typeof owner | null>(null)
  const pending = useRef(new Set<{ owner: typeof owner }>())
  const [, refresh] = useReducer((revision: number) => revision + 1, 0)
  useLayoutEffect(() => {
    committed.current = owner
    return () => {
      if (committed.current === owner) {
        committed.current = null
      }
    }
  }, [owner])

  const isCurrent = () => committed.current === owner
  const isBusy = () =>
    [...pending.current].some(
      ({ owner: attempt }) =>
        attempt.client === client && attempt.hostId === hostId && attempt.worktreeId === worktreeId
    )
  const begin = () => {
    if (!isCurrent() || !client || connState !== 'connected' || isBusy()) {
      return null
    }
    const attempt = { owner }
    pending.current.add(attempt)
    refresh()
    return {
      isCurrent,
      release: () => {
        if (pending.current.delete(attempt) && committed.current) {
          refresh()
        }
      }
    }
  }

  return { creating: isBusy(), isCurrent, isBusy, begin }
}
