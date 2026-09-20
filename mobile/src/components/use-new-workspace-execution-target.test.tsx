import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNewWorkspaceExecutionTarget } from './use-new-workspace-execution-target'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const response = (targetId: string, status: string) => ({
  id: 'response',
  ok: true as const,
  _meta: { runtimeId: 'r1' },
  result: { state: { targetId, status, error: null, reconnectAttempt: 0 } }
})

describe('new workspace execution target ownership', () => {
  let renderer: ReactTestRenderer | undefined
  let latest!: ReturnType<typeof useNewWorkspaceExecutionTarget>
  type Props = Parameters<typeof useNewWorkspaceExecutionTarget>[0]
  function Harness(props: Props) {
    latest = useNewWorkspaceExecutionTarget(props)
    return null
  }
  async function render(props: Props) {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, props))
      } else {
        renderer = create(createElement(Harness, props))
      }
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
  })

  it('does not replace a completed connect with an older disconnected snapshot', async () => {
    const initialState = deferred<ReturnType<typeof response>>()
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'ssh.getState') {
        return initialState.promise
      }
      if (method === 'ssh.connect') {
        return response('ssh-a', 'connected')
      }
      return { id: 'response', ok: true as const, result: ['claude'], _meta: { runtimeId: 'r1' } }
    })
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, connectionId: 'ssh-a', visible: true })
    await act(async () => latest.connect())
    expect(latest.sshGate.status).toBe('connected')
    await act(async () => initialState.resolve(response('ssh-a', 'disconnected')))
    expect(latest.sshGate.status).toBe('connected')
    expect(latest.sshGate.requiresConnection).toBe(false)
  })

  it('keeps the new target connected when the previous target connect finishes late', async () => {
    const oldConnect = deferred<ReturnType<typeof response>>()
    const sendRequest = vi.fn(async (method: string, params?: { targetId?: string }) => {
      const targetId = params?.targetId ?? 'ssh-a'
      if (method === 'ssh.getState') {
        return response(targetId, 'disconnected')
      }
      if (method === 'ssh.connect') {
        return targetId === 'ssh-a' ? oldConnect.promise : response(targetId, 'connected')
      }
      return { id: 'response', ok: true as const, result: ['claude'], _meta: { runtimeId: 'r1' } }
    })
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, connectionId: 'ssh-a', visible: true })
    let pending!: Promise<void>
    await act(async () => {
      pending = latest.connect()
    })
    await render({ client, connectionId: 'ssh-b', visible: true })
    await act(async () => latest.connect())
    expect(latest.sshGate.status).toBe('connected')
    await act(async () => {
      oldConnect.resolve(response('ssh-a', 'connected'))
      await pending
    })
    expect(latest.sshGate.status).toBe('connected')
    expect(latest.detectedAgentIds).toEqual(new Set(['claude']))
  })

  it('does not reuse connection readiness or callbacks across client replacement', async () => {
    const firstRequest = vi.fn(async (method: string) =>
      method === 'ssh.getState'
        ? response('ssh-a', 'connected')
        : { id: 'response', ok: true as const, result: ['claude'], _meta: { runtimeId: 'r1' } }
    )
    const client = { sendRequest: firstRequest } as unknown as RpcClient
    await render({ client, connectionId: 'ssh-a', visible: true })
    expect(latest.sshGate.requiresConnection).toBe(false)
    const oldConnect = latest.connect
    const newState = deferred<ReturnType<typeof response>>()
    const nextRequest = vi.fn(() => newState.promise)
    const nextClient = { sendRequest: nextRequest } as unknown as RpcClient
    await render({ client: nextClient, connectionId: 'ssh-a', visible: true })
    expect(latest.sshGate.requiresConnection).toBe(true)
    expect(latest.detectedAgentIds).toBeNull()
    await act(async () => oldConnect())
    expect(firstRequest).not.toHaveBeenCalledWith(
      'ssh.connect',
      expect.anything(),
      expect.anything()
    )
    await act(async () => newState.resolve(response('ssh-a', 'disconnected')))
  })
})
