import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  setTerminalAutoRestoreFitMsForHost,
  type TerminalAutoRestoreFitByHost
} from './terminal-auto-restore-fit-state'

function readAutoRestoreFitMs(response: RpcResponse): number | null {
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const result = response.result
  if (!result || typeof result !== 'object' || !('ms' in result)) {
    throw new Error('Invalid terminal setting from host')
  }
  const value = result.ms
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new Error('Invalid terminal setting from host')
  }
  return value
}

export function useTerminalAutoRestoreFitSettings(
  hostIds: readonly string[],
  clientsByHostId: ReadonlyMap<string, RpcClient>
) {
  const [hostMs, setHostMs] = useState<TerminalAutoRestoreFitByHost>({})
  const clientsRef = useRef(clientsByHostId)
  const pendingReadsRef = useRef(new Map<string, { client: RpcClient }>())
  const pendingWritesRef = useRef(new Map<string, number>())
  const revisionsRef = useRef(new Map<string, number>())
  const confirmedRef = useRef(new Map<string, number | null>())
  const mountedRef = useRef(false)

  useLayoutEffect(() => {
    const changedHostIds: string[] = []
    const allHostIds = new Set([...clientsRef.current.keys(), ...clientsByHostId.keys()])
    for (const hostId of allHostIds) {
      if (clientsRef.current.get(hostId) === clientsByHostId.get(hostId)) {
        continue
      }
      revisionsRef.current.set(hostId, (revisionsRef.current.get(hostId) ?? 0) + 1)
      confirmedRef.current.delete(hostId)
      pendingReadsRef.current.delete(hostId)
      pendingWritesRef.current.delete(hostId)
      changedHostIds.push(hostId)
    }
    clientsRef.current = clientsByHostId
    if (changedHostIds.length > 0) {
      setHostMs((previous) => {
        const changed = changedHostIds.filter((hostId) => hostId in previous)
        if (changed.length === 0) {
          return previous
        }
        const next = { ...previous }
        for (const hostId of changed) {
          delete next[hostId]
        }
        return next
      })
    }
  }, [clientsByHostId])
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    for (const hostId of hostIds) {
      const client = clientsByHostId.get(hostId)
      if (
        !client ||
        pendingReadsRef.current.get(hostId)?.client === client ||
        pendingWritesRef.current.has(hostId)
      ) {
        continue
      }
      const read = { client }
      pendingReadsRef.current.set(hostId, read)
      const revision = revisionsRef.current.get(hostId) ?? 0
      void client
        .sendRequest('terminal.getAutoRestoreFit')
        .then((response) => {
          if (
            !mountedRef.current ||
            clientsRef.current.get(hostId) !== client ||
            (revisionsRef.current.get(hostId) ?? 0) !== revision
          ) {
            return
          }
          const ms = readAutoRestoreFitMs(response)
          confirmedRef.current.set(hostId, ms)
          setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, ms))
        })
        .catch(() => {
          // Leave the value unknown; a failed read must not claim the default.
        })
        .finally(() => {
          if (pendingReadsRef.current.get(hostId) === read) {
            pendingReadsRef.current.delete(hostId)
          }
        })
    }
  }, [hostIds, clientsByHostId])

  const selectForHost = useCallback(async (hostId: string, ms: number | null) => {
    const client = clientsRef.current.get(hostId)
    if (!client) {
      return
    }
    const revision = (revisionsRef.current.get(hostId) ?? 0) + 1
    revisionsRef.current.set(hostId, revision)
    pendingWritesRef.current.set(hostId, revision)
    const isCurrent = () =>
      mountedRef.current &&
      clientsRef.current.get(hostId) === client &&
      revisionsRef.current.get(hostId) === revision
    setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, ms))

    try {
      const accepted = readAutoRestoreFitMs(
        await client.sendRequest('terminal.setAutoRestoreFit', { ms })
      )
      if (isCurrent()) {
        confirmedRef.current.set(hostId, accepted)
        setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, accepted))
      }
    } catch (error) {
      if (!isCurrent()) {
        return
      }
      try {
        const actual = readAutoRestoreFitMs(await client.sendRequest('terminal.getAutoRestoreFit'))
        if (isCurrent()) {
          confirmedRef.current.set(hostId, actual)
          setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, actual))
        }
      } catch {
        if (isCurrent()) {
          setHostMs((previous) => {
            if (confirmedRef.current.has(hostId)) {
              return setTerminalAutoRestoreFitMsForHost(
                previous,
                hostId,
                confirmedRef.current.get(hostId)!
              )
            }
            const next = { ...previous }
            delete next[hostId]
            return next
          })
        }
      }
      if (isCurrent()) {
        Alert.alert(
          'Could not confirm terminal setting',
          error instanceof Error ? error.message : 'Check the desktop connection and try again.'
        )
      }
    } finally {
      if (pendingWritesRef.current.get(hostId) === revision) {
        pendingWritesRef.current.delete(hostId)
      }
    }
  }, [])

  return { hostMs, selectForHost }
}
