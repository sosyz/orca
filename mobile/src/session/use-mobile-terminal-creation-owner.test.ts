import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileTerminalCreationOwner } from './use-mobile-terminal-creation-owner'

type Source = Parameters<typeof useMobileTerminalCreationOwner>[0]
const client = {} as RpcClient
const source = { client, hostId: 'host-A', worktreeId: 'wt-A', connState: 'connected' } as Source

describe('terminal creation source ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let current: ReturnType<typeof useMobileTerminalCreationOwner>

  function Harness(props: Source) {
    current = useMobileTerminalCreationOwner(props)
    return null
  }

  function render(props = source) {
    act(() => {
      const element = createElement(Harness, props)
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  function begin() {
    let claim: ReturnType<typeof current.begin> = null
    act(() => {
      claim = current.begin()
    })
    expect(claim).not.toBeNull()
    return claim!
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('claims synchronously before a second click can dispatch another create', () => {
    render()
    const first = current.begin
    act(() => {
      expect(first()).not.toBeNull()
      expect(first()).toBeNull()
    })
    expect(current.creating).toBe(true)
  })

  it.each([
    ['host', { hostId: 'host-B' }],
    ['workspace', { worktreeId: 'wt-B' }],
    ['client', { client: {} as RpcClient }],
    ['connection', { connState: 'disconnected' as ConnectionState }]
  ])(
    'retires old create continuations and callbacks after %s changes, including ABA',
    (_, change) => {
      render()
      const oldBegin = current.begin
      const claim = begin()
      render({ ...source, ...change })
      expect(claim.isCurrent()).toBe(false)
      expect(oldBegin()).toBeNull()
      render()
      expect(claim.isCurrent()).toBe(false)
      expect(oldBegin()).toBeNull()
      expect(current.creating).toBe(true)
      expect(current.begin()).toBeNull()
      act(() => claim.release())
      expect(current.creating).toBe(false)
      expect(begin().isCurrent()).toBe(true)
    }
  )

  it('a late release cannot release a new workspace claim', () => {
    render()
    const old = begin()
    render({ ...source, worktreeId: 'wt-B' })
    expect(current.creating).toBe(false)
    const next = begin()
    act(() => {
      old.release()
      old.release()
    })
    expect(current.creating).toBe(true)
    expect(current.begin()).toBeNull()
    expect(next.isCurrent()).toBe(true)
    act(() => next.release())
    expect(current.creating).toBe(false)
  })

  it('preserves same-source creation and accepted refresh after claim release', () => {
    render()
    const claim = begin()
    render({ ...source })
    expect(claim.isCurrent()).toBe(true)
    act(() => claim.release())
    expect(current.creating).toBe(false)
    expect(claim.isCurrent()).toBe(true)
    render({ ...source, worktreeId: 'wt-B' })
    expect(claim.isCurrent()).toBe(false)
  })

  it('prevents post-unmount RPC continuations and input feedback', async () => {
    render()
    const claim = begin()
    const send = vi.fn()
    let finish!: () => void
    const receipt = new Promise<void>((resolve) => {
      finish = resolve
    })
    const continuation = receipt.then(() => {
      if (claim.isCurrent()) {
        send()
      }
      claim.release()
    })
    act(() => renderer?.unmount())
    renderer = null
    finish()
    await continuation
    expect(send).not.toHaveBeenCalled()
    expect(current.begin()).toBeNull()
  })

  it.each(['disconnected', 'connecting', 'reconnecting'] as ConnectionState[])(
    'does not begin while %s',
    (connState) => {
      render({ ...source, connState })
      expect(current.begin()).toBeNull()
      expect(current.creating).toBe(false)
    }
  )
})
