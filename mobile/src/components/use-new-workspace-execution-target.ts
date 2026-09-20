import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SshConnectionState } from '../../../src/shared/ssh-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { deriveWorkspaceSshGate, type WorkspaceSshGate } from '../tasks/workspace-ssh-gate'

type ExecutionTargetScope = {
  client: RpcClient | null
  connectionId: string | null
  visible: boolean
}

type StateRequest = { scope: ExecutionTargetScope; revision: number }

type DetectedAgentIdsState = {
  scope: ExecutionTargetScope
  ids: Set<string>
}

function fallbackSshState(
  targetId: string,
  status: SshConnectionState['status'],
  error: string | null
): SshConnectionState {
  return { targetId, status, error, reconnectAttempt: 0 }
}

export function useNewWorkspaceExecutionTarget(args: {
  client: RpcClient | null
  connectionId: string | null
  visible: boolean
}): {
  sshGate: WorkspaceSshGate
  detectedAgentIds: Set<string> | null
  connect: () => Promise<void>
} {
  const { client, connectionId, visible } = args
  const scope = useMemo(() => ({ client, connectionId, visible }), [client, connectionId, visible])
  const scopeRef = useRef<ExecutionTargetScope | null>(null)
  const stateRevisionRef = useRef(0)
  const [sshState, setSshState] = useState<{
    scope: ExecutionTargetScope
    value: SshConnectionState
  } | null>(null)
  const [pendingConnect, setPendingConnect] = useState<StateRequest | null>(null)
  const [detectedAgentIdsState, setDetectedAgentIdsState] = useState<DetectedAgentIdsState | null>(
    null
  )
  const sshGate = deriveWorkspaceSshGate({
    connectionId,
    state: sshState?.scope === scope ? sshState.value : null,
    connecting: pendingConnect?.scope === scope
  })
  const detectedAgentIds =
    detectedAgentIdsState?.scope === scope &&
    (connectionId === null || sshGate.status === 'connected')
      ? detectedAgentIdsState.ids
      : null

  useLayoutEffect(() => {
    scopeRef.current = scope
    return () => {
      scopeRef.current = null
      stateRevisionRef.current += 1
    }
  }, [scope])

  const isCurrentRequest = useCallback(
    (request: StateRequest) =>
      scopeRef.current === request.scope && stateRevisionRef.current === request.revision,
    []
  )

  useEffect(() => {
    if (!visible || !client || !connectionId) {
      return
    }
    const request = { scope, revision: ++stateRevisionRef.current }
    void client
      .sendRequest('ssh.getState', { targetId: connectionId })
      .then((response) => {
        if (!isCurrentRequest(request)) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const state = (response as RpcSuccess).result as { state?: SshConnectionState | null }
        setSshState({
          scope,
          value: state.state ?? fallbackSshState(connectionId, 'disconnected', null)
        })
      })
      .catch((error) => {
        if (isCurrentRequest(request)) {
          setSshState({
            scope,
            value: fallbackSshState(
              connectionId,
              'error',
              error instanceof Error ? error.message : 'Failed to read SSH connection state.'
            )
          })
        }
      })
    return () => {
      if (isCurrentRequest(request)) {
        stateRevisionRef.current += 1
      }
    }
  }, [client, connectionId, isCurrentRequest, scope, visible])

  useEffect(() => {
    if (!visible || !client || (connectionId && sshGate.status !== 'connected')) {
      return
    }
    let stale = false
    void (async () => {
      try {
        const response = connectionId
          ? await client.sendRequest('preflight.detectRemoteAgents', { connectionId })
          : await client.sendRequest('preflight.detectAgents')
        if (!stale) {
          setDetectedAgentIdsState({
            scope,
            ids: response.ok ? new Set((response as RpcSuccess).result as string[]) : new Set()
          })
        }
      } catch {
        if (!stale) {
          setDetectedAgentIdsState({ scope, ids: new Set() })
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [client, connectionId, scope, sshGate.status, visible])

  async function connect(): Promise<void> {
    if (!client || !connectionId || !visible || scopeRef.current !== scope) {
      return
    }
    // An explicit connect supersedes an older getState snapshot.
    const request = { scope, revision: ++stateRevisionRef.current }
    setPendingConnect(request)
    setSshState({ scope, value: fallbackSshState(connectionId, 'connecting', null) })
    try {
      const response = await client.sendRequest(
        'ssh.connect',
        { targetId: connectionId },
        { timeoutMs: 120_000 }
      )
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      if (!isCurrentRequest(request)) {
        return
      }
      const result = (response as RpcSuccess).result as { state?: SshConnectionState | null }
      setSshState({
        scope,
        value: result.state ?? fallbackSshState(connectionId, 'connected', null)
      })
    } catch (error) {
      if (isCurrentRequest(request)) {
        setSshState({
          scope,
          value: fallbackSshState(
            connectionId,
            'error',
            error instanceof Error ? error.message : 'Failed to connect to SSH repository.'
          )
        })
      }
    } finally {
      if (isCurrentRequest(request)) {
        setPendingConnect((current) => (current === request ? null : current))
      }
    }
  }

  return { sshGate, detectedAgentIds, connect }
}
