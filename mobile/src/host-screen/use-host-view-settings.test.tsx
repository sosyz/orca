import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useHostScreenState } from './use-host-screen-state'
import { useHostViewSettings } from './use-host-view-settings'

vi.mock('../cache/worktree-cache', () => ({ getCachedWorktrees: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const response = (ui: unknown = {}) => ({ id: 'ui', ok: true, result: { ui } })
const renderers: ReactTestRenderer[] = []

function mount(sendRequest: ReturnType<typeof vi.fn>) {
  let client = { sendRequest } as unknown as RpcClient
  let hostId = 'host-a'
  let state!: ReturnType<typeof useHostScreenState>
  let settings!: ReturnType<typeof useHostViewSettings>
  function Harness() {
    state = useHostScreenState(hostId, undefined)
    useLayoutEffect(() => {
      state.clientRef.current = client
    }, [client])
    settings = useHostViewSettings({ client, connState: 'connected', hostId, state })
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness))
  })
  renderers.push(renderer)
  return {
    get settings() {
      return settings
    },
    get state() {
      return state
    },
    changeHost(nextHostId: string, nextClient = client) {
      act(() => {
        hostId = nextHostId
        client = nextClient
        renderer.update(createElement(Harness))
      })
    },
    unmount: () => act(() => renderer.unmount())
  }
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    act(() => renderer.unmount())
  }
})

describe('workspace view settings synchronization', () => {
  it('does not undo a local sort selection with an older desktop snapshot', async () => {
    const read = deferred<ReturnType<typeof response>>()
    const sendRequest = vi.fn((method: string) =>
      method === 'ui.get' ? read.promise : Promise.resolve(response())
    )
    const current = mount(sendRequest)
    let syncing!: Promise<void>
    act(() => {
      syncing = current.settings.syncViewSettingsFromDesktop()
    })
    act(() => current.settings.handleSortChange('name'))
    await act(async () => {
      read.resolve(response({ sortBy: 'recent', groupBy: 'none' }))
      await syncing
    })
    expect(current.state.sortMode).toBe('name')
    expect(current.state.groupMode).toBe('none')
    expect(sendRequest).toHaveBeenCalledWith('ui.set', { sortBy: 'name' })
  })

  it('does not let an older desktop read overwrite the latest one', async () => {
    const first = deferred<ReturnType<typeof response>>()
    const second = deferred<ReturnType<typeof response>>()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const current = mount(sendRequest)
    let oldRead!: Promise<void>
    let newRead!: Promise<void>
    act(() => {
      oldRead = current.settings.syncViewSettingsFromDesktop()
      newRead = current.settings.syncViewSettingsFromDesktop()
    })
    await act(async () => {
      second.resolve(response({ groupBy: 'none' }))
      await newRead
    })
    await act(async () => {
      first.resolve(response({ groupBy: 'repo' }))
      await oldRead
    })
    expect(current.state.groupMode).toBe('none')
  })

  it('ignores old view actions after the host scope changes even if a client is reused', async () => {
    const sendRequest = vi.fn().mockResolvedValue(response())
    const current = mount(sendRequest)
    const oldSettings = current.settings
    current.changeHost('host-b')
    act(() => oldSettings.handleSortChange('name'))
    expect(current.state.sortMode).toBe('recent')
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('protects a still-pending field after an earlier write to that field finishes', async () => {
    const firstWrite = deferred<ReturnType<typeof response>>()
    const secondWrite = deferred<ReturnType<typeof response>>()
    const read = deferred<ReturnType<typeof response>>()
    let writes = 0
    const sendRequest = vi.fn((method: string) => {
      if (method === 'ui.get') {
        return read.promise
      }
      return ++writes === 1 ? firstWrite.promise : secondWrite.promise
    })
    const current = mount(sendRequest)
    act(() => {
      current.settings.handleSortChange('name')
      current.settings.handleSortChange('repo')
    })
    await act(async () => firstWrite.resolve(response()))
    let syncing!: Promise<void>
    act(() => {
      syncing = current.settings.syncViewSettingsFromDesktop()
    })
    await act(async () => {
      secondWrite.resolve(response())
      read.resolve(response({ sortBy: 'name', hideSleepingWorkspaces: true }))
      await syncing
    })
    expect(current.state.sortMode).toBe('repo')
    expect(current.state.filters.hideSleeping).toBe(true)
    sendRequest.mockResolvedValue(response({ sortBy: 'smart' }))
    await act(async () => current.settings.syncViewSettingsFromDesktop())
    expect(current.state.sortMode).toBe('smart')
  })

  it('preserves an edit back to the original value while a snapshot is pending', async () => {
    const read = deferred<ReturnType<typeof response>>()
    const current = mount(
      vi.fn((method: string) => (method === 'ui.get' ? read.promise : Promise.resolve(response())))
    )
    let syncing!: Promise<void>
    act(() => {
      syncing = current.settings.syncViewSettingsFromDesktop()
    })
    act(() => {
      current.settings.handleSortChange('name')
      current.settings.handleSortChange('recent')
    })
    await act(async () => {
      read.resolve(response({ sortBy: 'repo' }))
      await syncing
    })
    expect(current.state.sortMode).toBe('recent')
  })

  it('does not apply an old read after unmount', async () => {
    const read = deferred<ReturnType<typeof response>>()
    const current = mount(vi.fn(() => read.promise))
    let syncing!: Promise<void>
    act(() => {
      syncing = current.settings.syncViewSettingsFromDesktop()
    })
    current.unmount()
    await act(async () => {
      read.resolve(response({ sortBy: 'name' }))
      await syncing
    })
    expect(current.state.viewStateRef.current.sortMode).toBe('recent')
  })
})
