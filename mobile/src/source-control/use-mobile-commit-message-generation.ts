import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { cancelMobileCommitMessage, requestMobileCommitMessage } from './mobile-commit-message-ai'

type Params = {
  client: RpcClient | null
  worktreeId: string
  commitMessage: string
  mountedRef: MutableRefObject<boolean>
  busyActionRef: MutableRefObject<string | null>
  setGeneratingMessage: (next: boolean) => void
  setCommitMessage: (next: string) => void
  setActionError: (next: string | null) => void
}

export function useMobileCommitMessageGeneration(params: Params) {
  const {
    client,
    worktreeId,
    commitMessage,
    mountedRef,
    busyActionRef,
    setGeneratingMessage,
    setCommitMessage,
    setActionError
  } = params
  const source = useMemo(() => ({ client, worktreeId }), [client, worktreeId])
  const committedRef = useRef<typeof source | null>(null)
  const pendingRef = useRef(new WeakMap<RpcClient, Map<string, { canceled: boolean }>>())
  const draftRef = useRef({ value: commitMessage, revision: 0 })
  useLayoutEffect(() => {
    if (draftRef.current.value !== commitMessage) {
      draftRef.current = { value: commitMessage, revision: draftRef.current.revision + 1 }
    }
  }, [commitMessage])
  useLayoutEffect(() => {
    committedRef.current = source
    setGeneratingMessage(Boolean(client && pendingRef.current.get(client)?.has(worktreeId)))
    return () => {
      committedRef.current = null
    }
  }, [client, setGeneratingMessage, source, worktreeId])
  const isCurrent = useCallback(
    () => mountedRef.current && committedRef.current === source,
    [mountedRef, source]
  )

  // AI-generate a commit message from the staged diff. Matches desktop: the
  // button is always available; a missing model surfaces as a toast.
  const generateCommitMessage = useCallback(async () => {
    if (
      !isCurrent() ||
      !client ||
      busyActionRef.current ||
      pendingRef.current.get(client)?.has(worktreeId)
    ) {
      return
    }
    const pending = pendingRef.current.get(client) ?? new Map<string, { canceled: boolean }>()
    pendingRef.current.set(client, pending)
    const attempt = { canceled: false }
    pending.set(worktreeId, attempt)
    const draftRevision = draftRef.current.revision
    setGeneratingMessage(true)
    setActionError(null)
    try {
      const result = await requestMobileCommitMessage(client, worktreeId)
      if (!isCurrent() || attempt.canceled) {
        return
      }
      if (result.success) {
        if (draftRef.current.revision === draftRevision) {
          setCommitMessage(result.message)
          triggerSuccess()
        }
      } else if (!result.canceled) {
        triggerError()
        setActionError(result.error)
      }
    } catch (err) {
      // Why: a transport drop rejects the RPC; without this the error haptic +
      // message are skipped and the rejection escapes the void-called handler.
      if (isCurrent() && !attempt.canceled) {
        triggerError()
        setActionError(err instanceof Error ? err.message : 'Failed to generate commit message')
      }
    } finally {
      if (pending.get(worktreeId) === attempt) {
        pending.delete(worktreeId)
      }
      if (pending.size === 0) {
        pendingRef.current.delete(client)
      }
      const current = committedRef.current
      if (mountedRef.current && current?.client === client && current.worktreeId === worktreeId) {
        setGeneratingMessage(false)
      }
    }
  }, [
    busyActionRef,
    client,
    isCurrent,
    mountedRef,
    setActionError,
    setCommitMessage,
    setGeneratingMessage,
    worktreeId
  ])

  const cancelGenerateCommitMessage = useCallback(() => {
    const attempt = client && pendingRef.current.get(client)?.get(worktreeId)
    if (client && isCurrent() && attempt && !attempt.canceled) {
      attempt.canceled = true
      void cancelMobileCommitMessage(client, worktreeId).catch((error: unknown) => {
        if (isCurrent() && pendingRef.current.get(client)?.get(worktreeId) === attempt) {
          triggerError()
          setActionError(error instanceof Error ? error.message : 'Failed to cancel generation')
        }
      })
    }
  }, [client, isCurrent, setActionError, worktreeId])

  return { generateCommitMessage, cancelGenerateCommitMessage }
}
