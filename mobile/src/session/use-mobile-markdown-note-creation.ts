import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { captureMobileFileMutationOwnership } from '../files/mobile-file-mutation-ownership'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcFailure } from '../transport/types'
import { isFileExistsErrorMessage } from './mobile-session-route-helpers'

type MarkdownNoteCreationArgs = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  fetchSessionTabs: () => void
  scheduleDelayedAction: (callback: () => void, ms: number) => void
  setCreateError: (message: string) => void
  showToast: (message: string, durationMs?: number) => void
}

type PendingMarkdownCreation = {
  claim: object
  client: RpcClient
  hostId: string
  worktreeId: string
}

export function useMobileMarkdownNoteCreation({
  client,
  connState,
  hostId,
  worktreeId,
  fetchSessionTabs,
  scheduleDelayedAction,
  setCreateError,
  showToast
}: MarkdownNoteCreationArgs) {
  const source = useMemo(
    () => ({ client, connState, hostId, worktreeId }),
    [client, connState, hostId, worktreeId]
  )
  const ownerRef = useRef<{ source: typeof source } | null>(null)
  const claimRef = useRef<object | null>(null)
  const pendingRef = useRef(new Set<PendingMarkdownCreation>())
  const [, setBusyVersion] = useState(0)

  useLayoutEffect(() => {
    const owner = { source }
    ownerRef.current = owner
    claimRef.current = null
    return () => {
      if (ownerRef.current === owner) {
        ownerRef.current = null
        claimRef.current = null
      }
    }
  }, [source])

  const hasPendingForTarget = () => {
    for (const pending of pendingRef.current) {
      if (
        pending.client === client &&
        pending.hostId === hostId &&
        pending.worktreeId === worktreeId
      ) {
        return true
      }
    }
    return false
  }

  async function createMarkdownNote(): Promise<void> {
    const owner = ownerRef.current
    if (
      !client ||
      connState !== 'connected' ||
      owner?.source !== source ||
      claimRef.current ||
      hasPendingForTarget()
    ) {
      return
    }
    const claim = {}
    const pending = { claim, client, hostId, worktreeId }
    pendingRef.current.add(pending)
    claimRef.current = claim
    setBusyVersion((version) => version + 1)
    const isCurrentOwner = () => ownerRef.current === owner
    const isCurrentRequest = () => isCurrentOwner() && claimRef.current === claim
    const checkedClient: Pick<RpcClient, 'sendRequest'> = {
      sendRequest: (method, params, options) => {
        if (!isCurrentRequest()) {
          throw new Error('Markdown creation source changed')
        }
        return client.sendRequest(method, params, options)
      }
    }

    setCreateError('')
    try {
      const worktree = `id:${worktreeId}`
      const mutationOwnership = await captureMobileFileMutationOwnership(checkedClient, worktree)
      if (!isCurrentRequest()) {
        return
      }
      for (let attempt = 1; attempt <= 100; attempt += 1) {
        const relativePath = attempt === 1 ? 'untitled.md' : `untitled-${attempt}.md`
        const createResponse = await checkedClient.sendRequest(
          'files.createFile',
          { worktree, relativePath, ...mutationOwnership },
          { timeoutMs: 15_000 }
        )
        if (!isCurrentRequest()) {
          return
        }
        if (!createResponse.ok) {
          const message = (createResponse as RpcFailure).error.message
          if (isFileExistsErrorMessage(message) && attempt < 100) {
            continue
          }
          throw new Error(message || 'Failed to create markdown note')
        }
        const openResponse = await checkedClient.sendRequest(
          'files.open',
          { worktree, relativePath },
          { timeoutMs: 15_000 }
        )
        if (!isCurrentRequest()) {
          return
        }
        if (!openResponse.ok) {
          throw new Error((openResponse as RpcFailure).error.message)
        }
        scheduleDelayedAction(() => {
          if (isCurrentOwner()) {
            fetchSessionTabs()
          }
        }, 300)
        return
      }
      throw new Error('Unable to create untitled markdown note')
    } catch (err) {
      if (!isCurrentRequest()) {
        return
      }
      const message = err instanceof Error ? err.message : 'Failed to create markdown note'
      setCreateError(message)
      showToast(message, 1800)
    } finally {
      pendingRef.current.delete(pending)
      if (isCurrentRequest()) {
        claimRef.current = null
      }
      if (ownerRef.current) {
        setBusyVersion((version) => version + 1)
      }
    }
  }

  return { creatingMarkdown: hasPendingForTarget(), createMarkdownNote }
}
