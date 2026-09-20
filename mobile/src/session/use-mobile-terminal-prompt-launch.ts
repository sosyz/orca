import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { createTerminalAndSendPrompt } from './pr-ai-triage-launch'

type Input = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  target: object | null
}

export function useMobileTerminalPromptLaunch<Key extends string>(input: Input) {
  const { client, connState, worktreeId, target } = input
  const owner = useMemo(
    () => ({ client, worktreeId, connState, target }),
    [client, worktreeId, connState, target]
  )
  const committedOwner = useRef<typeof owner | null>(null)
  const attempts = useRef(new Set<{ client: RpcClient; worktreeId: string; key: Key }>())
  const [, refreshBusy] = useReducer((revision: number) => revision + 1, 0)
  const [failure, setFailure] = useState<{ owner: typeof owner; message: string } | null>(null)
  useLayoutEffect(() => {
    committedOwner.current = owner
    return () => {
      if (committedOwner.current === owner) {
        committedOwner.current = null
      }
    }
  }, [owner])

  const launch = useCallback(
    async (key: Key, buildPrompt: () => string): Promise<boolean> => {
      const isCurrent = () => committedOwner.current === owner
      if (!isCurrent() || !target) {
        return false
      }
      for (const attempt of attempts.current) {
        if (attempt.client === client && attempt.worktreeId === worktreeId) {
          return false
        }
      }
      if (!client || connState !== 'connected') {
        setFailure({ owner, message: 'Waiting for desktop...' })
        triggerError()
        return false
      }
      const attempt = { client, worktreeId, key }
      attempts.current.add(attempt)
      refreshBusy()
      setFailure(null)
      try {
        const sent = await createTerminalAndSendPrompt(client, worktreeId, buildPrompt(), isCurrent)
        if (!sent || !isCurrent()) {
          return false
        }
        triggerSuccess()
        return true
      } catch (err) {
        if (isCurrent()) {
          triggerError()
          setFailure({
            owner,
            message: err instanceof Error ? err.message : 'Failed to launch agent'
          })
        }
        return false
      } finally {
        attempts.current.delete(attempt)
        if (committedOwner.current) {
          refreshBusy()
        }
      }
    },
    [client, connState, worktreeId, target, owner]
  )

  return {
    error: failure?.owner === owner ? failure.message : null,
    clearError: useCallback(() => {
      if (committedOwner.current === owner) {
        setFailure(null)
      }
    }, [owner]),
    isBusy: (key: Key) =>
      [...attempts.current].some(
        (attempt) =>
          attempt.client === client && attempt.worktreeId === worktreeId && attempt.key === key
      ),
    launch
  }
}
