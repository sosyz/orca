import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Alert } from 'react-native'
import type { useRouter } from 'expo-router'
import { getProvenCachedWorktrees } from '../cache/worktree-cache'
import { floatingWorkspaceSessionPath } from '../session/floating-workspace'
import { savePinnedIds } from '../storage/preferences'
import type { useForgetHostClient } from '../transport/client-context'
import { removeHostAndCloseClient } from '../transport/host-removal-lifecycle'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { setHostRouteNewWorktreeVisible } from '../host-route-action-state'
import { leaveHostRoute } from '../host-route-exit'
import {
  getWorktreeRowIdentity,
  isSameWorktreeRow,
  removeWorktreeRow,
  restoreWorktreeRow
} from '../worktree/worktree-host-row-identity'
import { isWorktreePinned, type Worktree } from '../worktree/workspace-list-sections'
import type { HostScreenState } from './use-host-screen-state'

export function useHostWorktreeActions(args: {
  client: RpcClient | null
  connState: ConnectionState
  embedded: boolean
  fetchWorktrees: (options?: {
    allowDuringModal?: boolean
    queueIfInFlight?: boolean
  }) => Promise<void>
  forgetHostClient: ReturnType<typeof useForgetHostClient>
  hostId: string | undefined
  pathname: string
  router: ReturnType<typeof useRouter>
  state: HostScreenState
}) {
  const {
    client,
    connState,
    embedded,
    fetchWorktrees,
    forgetHostClient,
    hostId,
    pathname,
    router,
    state
  } = args
  const {
    newWorktreeModalRef,
    newWorktreeModalVisibleRef,
    pinnedIds,
    setConfirmRemoveHost,
    setLastKnownWorktrees,
    setOptimisticActiveWorktreeIdentity,
    setPinnedIds,
    setRouteActionState,
    setSleptIds,
    setWorktrees,
    worktrees
  } = state
  const sleepAttemptByIdentityRef = useRef(new Map<string, symbol>())
  const owner = useMemo(() => ({ client, hostId }), [client, hostId])
  const ownerRef = useRef<typeof owner | null>(null)
  const hostOwner = useMemo(() => ({ hostId }), [hostId])
  const hostOwnerRef = useRef<typeof hostOwner | null>(null)
  const previousHostIdRef = useRef(hostId)

  useLayoutEffect(() => {
    const hostChanged = previousHostIdRef.current !== hostId
    previousHostIdRef.current = hostId
    setSleptIds((previous) => (previous.size === 0 ? previous : new Set()))
    if (hostChanged) {
      setOptimisticActiveWorktreeIdentity(null)
    }
    ownerRef.current = owner
    return () => {
      if (ownerRef.current === owner) {
        ownerRef.current = null
      }
      sleepAttemptByIdentityRef.current.clear()
    }
  }, [hostId, owner, setOptimisticActiveWorktreeIdentity, setSleptIds])

  useLayoutEffect(() => {
    hostOwnerRef.current = hostOwner
    return () => {
      if (hostOwnerRef.current === hostOwner) {
        hostOwnerRef.current = null
      }
    }
  }, [hostOwner])

  const leaveHost = useCallback(() => {
    leaveHostRoute(router)
  }, [router])

  const openNewWorktreeModal = useCallback(() => {
    const modal = newWorktreeModalRef.current
    if (!modal) {
      return
    }
    newWorktreeModalVisibleRef.current = true
    modal.open()
  }, [])

  const setShowNewWorktreeVisible = useCallback((visible: boolean) => {
    setRouteActionState((current) => setHostRouteNewWorktreeVisible(current, visible))
  }, [])

  const updateLocalPins = useCallback(
    (worktreeId: string, pinned: boolean) => {
      setPinnedIds((prev) => {
        const next = new Set(prev)
        if (pinned) {
          next.add(worktreeId)
        } else {
          next.delete(worktreeId)
        }
        if (hostId) {
          void savePinnedIds(hostId, next)
        }
        return next
      })
    },
    [hostId]
  )

  const togglePin = useCallback(
    (worktreeId: string) => {
      const worktree = worktrees.find((w) => w.worktreeId === worktreeId)
      const currentlyPinned = worktree
        ? isWorktreePinned(worktree, pinnedIds)
        : pinnedIds.has(worktreeId)
      const newPinned = !currentlyPinned

      setWorktrees((prev) =>
        prev.map((w) => (w.worktreeId === worktreeId ? { ...w, isPinned: newPinned } : w))
      )
      setLastKnownWorktrees((prev) =>
        prev.map((w) => (w.worktreeId === worktreeId ? { ...w, isPinned: newPinned } : w))
      )

      updateLocalPins(worktreeId, newPinned)

      if (client) {
        client
          .sendRequest('worktree.set', {
            worktree: `id:${worktreeId}`,
            isPinned: newPinned
          })
          .catch(() => {})
      }
    },
    [client, worktrees, pinnedIds, updateLocalPins]
  )

  const handleDeleteWorktree = useCallback(
    async (item: Worktree) => {
      if (!client || ownerRef.current !== owner) {
        return
      }
      const isCurrent = () => ownerRef.current === owner
      const provenAtStart = hostId ? getProvenCachedWorktrees(hostId) : null

      const removeFromList = (list: Worktree[]) =>
        isCurrent() ? removeWorktreeRow(list, item) : list
      setWorktrees(removeFromList)
      setLastKnownWorktrees(removeFromList)

      let failed = false
      try {
        const response = await client.sendRequest('worktree.rm', {
          worktree: `id:${item.worktreeId}`,
          force: true
        })
        if (!response.ok) {
          failed = true
        }
      } catch {
        failed = true
      }
      if (!isCurrent()) {
        return
      }
      if (failed) {
        const latestProven = hostId ? getProvenCachedWorktrees(hostId) : null
        const confirmedRemoved =
          latestProven !== null &&
          latestProven !== provenAtStart &&
          !latestProven.some((row) => isSameWorktreeRow(row as Worktree, item))
        if (!confirmedRemoved) {
          setWorktrees((prev) => (isCurrent() ? restoreWorktreeRow(prev, item) : prev))
          setLastKnownWorktrees((prev) => (isCurrent() ? restoreWorktreeRow(prev, item) : prev))
          Alert.alert('Could not delete workspace', 'Please try again.')
        }
      }
      void fetchWorktrees({ allowDuringModal: true, queueIfInFlight: true })
    },
    [client, fetchWorktrees, hostId, owner]
  )

  const handleSleepWorktree = useCallback(
    async (item: Worktree) => {
      if (ownerRef.current !== owner) {
        return
      }
      if (!client || connState !== 'connected') {
        Alert.alert('Could not sleep workspace', 'Check the connection and try again.')
        return
      }
      const isCurrent = () => ownerRef.current === owner
      const identity = getWorktreeRowIdentity(item)
      const attempt = Symbol('worktree sleep')
      sleepAttemptByIdentityRef.current.set(identity, attempt)
      setSleptIds((prev) => (isCurrent() ? new Set(prev).add(identity) : prev))
      try {
        const response = await client.sendRequest(
          'worktree.sleep',
          { worktree: `id:${item.worktreeId}` },
          { failWhenDisconnected: true }
        )
        if (!response.ok) {
          throw new Error(response.error.message)
        }
      } catch {
        if (isCurrent() && sleepAttemptByIdentityRef.current.get(identity) === attempt) {
          setSleptIds((prev) => {
            if (!isCurrent()) {
              return prev
            }
            const next = new Set(prev)
            next.delete(identity)
            return next
          })
          Alert.alert('Could not sleep workspace', 'Check the connection and try again.')
        }
      } finally {
        if (isCurrent() && sleepAttemptByIdentityRef.current.get(identity) === attempt) {
          sleepAttemptByIdentityRef.current.delete(identity)
        }
      }
    },
    [client, connState, owner, setSleptIds]
  )

  const handleRemoveHost = useCallback(async () => {
    if (!hostId || hostOwnerRef.current !== hostOwner) {
      return
    }
    const isCurrent = () => hostOwnerRef.current === hostOwner
    try {
      await removeHostAndCloseClient(hostId, forgetHostClient)
      if (isCurrent()) {
        leaveHost()
      }
    } catch {
      if (!isCurrent()) {
        return
      }
      // Why: removal can fail while still paired; re-open confirm (ConfirmModal closes on confirm).
      setConfirmRemoveHost((current) => (isCurrent() ? true : current))
      Alert.alert('Could not remove host', 'Please try again.')
    }
  }, [hostId, leaveHost, forgetHostClient, hostOwner])

  const navigateFromHostList = useCallback(
    (target: string) => {
      if (!embedded) {
        router.push(target)
        return
      }
      if (pathname === (target.split('?')[0] ?? target)) {
        return
      }
      if (pathname === `/h/${hostId}`) {
        router.push(target)
        return
      }
      router.replace(target)
    },
    [embedded, hostId, pathname, router]
  )

  const openWorktreeSession = useCallback(
    (item: Worktree) => {
      setOptimisticActiveWorktreeIdentity(getWorktreeRowIdentity(item))
      if (client && connState === 'connected') {
        void client
          .sendRequest('worktree.activate', {
            worktree: `id:${item.worktreeId}`,
            notifyClients: false,
            navigation: 'caller'
          })
          .catch(() => null)
      }
      const target = `/h/${hostId}/session/${encodeURIComponent(item.worktreeId)}?name=${encodeURIComponent(item.displayName || item.repo)}`
      navigateFromHostList(target)
    },
    [client, connState, hostId, navigateFromHostList]
  )

  const openFloatingWorkspace = useCallback(() => {
    // Why: no worktree.activate here — the floating sentinel has no worktree
    // record; session.tabs.list hydrates its host-owned tabs on open.
    navigateFromHostList(floatingWorkspaceSessionPath(hostId))
  }, [hostId, navigateFromHostList])

  return {
    handleDeleteWorktree,
    handleRemoveHost,
    handleSleepWorktree,
    leaveHost,
    navigateFromHostList,
    openFloatingWorkspace,
    openNewWorktreeModal,
    openWorktreeSession,
    setShowNewWorktreeVisible,
    togglePin
  }
}

export type HostWorktreeActions = ReturnType<typeof useHostWorktreeActions>
