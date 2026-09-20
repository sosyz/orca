import { useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcSuccess } from '../transport/types'
import { normalizeBrowserUrl } from './browser-url'

type Params = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  browserScreencastSupportedRef: { current: boolean | null }
  pendingBrowserFocusPageIdRef: MutableRefObject<string | null>
  fetchSessionTabs: () => Promise<void>
  fetchPendingBrowserSessionTabs: () => Promise<void>
  scheduleDelayedAction: (action: () => void, delayMs: number) => void
  setCreateError: (message: string) => void
  showToast: (message: string, durationMs?: number) => void
  setShowCreateBrowserModal: (visible: boolean) => void
}

export function useMobileBrowserTabCreation(args: Params) {
  const { client, connState, hostId, worktreeId } = args
  const owner = useMemo(
    () => ({ client, connState, hostId, worktreeId }),
    [client, connState, hostId, worktreeId]
  )
  const committedOwnerRef = useRef<typeof owner | null>(null)
  const committedArgsRef = useRef(args)
  const pendingRef = useRef(new Set<typeof owner>())
  const dialogTokenRef = useRef<object | null>(null)
  const [dialogToken, setDialogToken] = useState<object | null>(null)
  const [, refreshBusy] = useState(0)
  useLayoutEffect(() => {
    committedArgsRef.current = args
  })
  useLayoutEffect(() => {
    committedOwnerRef.current = owner
    return () => {
      if (committedOwnerRef.current === owner) {
        committedOwnerRef.current = null
        if (dialogTokenRef.current) {
          dialogTokenRef.current = null
          committedArgsRef.current.setShowCreateBrowserModal(false)
        }
      }
    }
  }, [owner])
  const isCurrent = () => committedOwnerRef.current === owner
  const hasPendingCreation = () =>
    [...pendingRef.current].some(
      (pending) =>
        pending.client === client && pending.hostId === hostId && pending.worktreeId === worktreeId
    )
  const canCreate = () => isCurrent() && client !== null && connState === 'connected'
  const supportsScreencast = () => {
    const current = committedArgsRef.current
    if (current.browserScreencastSupportedRef.current === true) {
      return true
    }
    current.showToast('Desktop update required for mobile browser streaming', 1600)
    return false
  }
  async function handleCreateBrowser(rawUrl = 'about:blank'): Promise<boolean> {
    if (!canCreate() || !client || hasPendingCreation()) {
      return false
    }
    if (!supportsScreencast()) {
      return false
    }
    const url = normalizeBrowserUrl(rawUrl)
    if (!url) {
      committedArgsRef.current.setCreateError('Enter a valid URL')
      committedArgsRef.current.showToast('Enter a valid URL', 1400)
      return false
    }
    pendingRef.current.add(owner)
    refreshBusy((version) => version + 1)
    committedArgsRef.current.setCreateError('')
    try {
      const response = await client.sendRequest(
        'browser.tabCreate',
        { worktree: `id:${worktreeId}`, url, activate: true },
        { timeoutMs: 30_000 }
      )
      // The host may have created the page; only its original screen may consume the receipt.
      if (!isCurrent()) {
        return false
      }
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      const created = (response as RpcSuccess).result as { browserPageId?: string }
      const current = committedArgsRef.current
      if (created.browserPageId) {
        current.pendingBrowserFocusPageIdRef.current = created.browserPageId
      }
      void current.fetchSessionTabs()
      for (const delay of [400, 1200]) {
        current.scheduleDelayedAction(() => {
          if (isCurrent()) {
            void committedArgsRef.current.fetchPendingBrowserSessionTabs()
          }
        }, delay)
      }
      return true
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : 'Failed to create browser'
        committedArgsRef.current.setCreateError(message)
        committedArgsRef.current.showToast(message, 1800)
      }
      return false
    } finally {
      pendingRef.current.delete(owner)
      if (committedOwnerRef.current) {
        refreshBusy((version) => version + 1)
      }
    }
  }
  const openBrowserDialog = () => {
    if (!canCreate() || !supportsScreencast()) {
      return
    }
    const token = {}
    dialogTokenRef.current = token
    setDialogToken(token)
    committedArgsRef.current.setShowCreateBrowserModal(true)
  }
  const cancelBrowserDialog = () => {
    if (isCurrent() && dialogToken !== null && dialogTokenRef.current === dialogToken) {
      dialogTokenRef.current = null
      setDialogToken(null)
      committedArgsRef.current.setShowCreateBrowserModal(false)
    }
  }
  const submitBrowserUrl = async (url: string): Promise<void> => {
    if (!isCurrent() || dialogToken === null || dialogTokenRef.current !== dialogToken) {
      return
    }
    if (await handleCreateBrowser(url)) {
      if (isCurrent() && dialogTokenRef.current === dialogToken) {
        dialogTokenRef.current = null
        setDialogToken(null)
        committedArgsRef.current.setShowCreateBrowserModal(false)
      }
    }
  }
  return {
    isCurrentSource: isCurrent,
    creatingBrowser: hasPendingCreation(),
    handleCreateBrowser,
    openBrowserDialog,
    submitBrowserUrl,
    cancelBrowserDialog
  }
}
