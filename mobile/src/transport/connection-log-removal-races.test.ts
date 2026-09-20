import { describe, expect, it, vi } from 'vitest'
import { createConnectionLogStore } from './connection-log-buffer'
import type { ConnectionLogEntry } from './types'

function entry(id: number): ConnectionLogEntry {
  return { id: `log-${id}`, ts: id, level: 'info', message: `event ${id}` }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('connection log removal races', () => {
  it('keeps new-session logs when the prior session removal finishes', async () => {
    const removal = deferred<void>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const remove = vi.fn(async () => {
      await removal.promise
      disk = []
    })
    const save = vi.fn(async (_hostId: string, entries: readonly ConnectionLogEntry[]) => {
      disk = entries
    })
    const store = createConnectionLogStore(200, { load: async () => disk, save, remove })
    await store.hydrate('host-a')
    const removing = store.remove('host-a')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())

    store.activate('host-a')
    store.append('host-a', entry(2))
    removal.resolve()
    await removing

    expect(store.get('host-a')).toEqual([entry(2)])
    await vi.waitFor(() => expect(disk).toEqual([entry(2)]))
  })

  it('does not start a diagnostic hydration while a host is being removed', async () => {
    const removal = deferred<void>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const load = vi.fn(async () => disk)
    const remove = vi.fn(async () => {
      await removal.promise
      disk = []
    })
    const store = createConnectionLogStore(200, {
      load,
      save: async (_hostId, entries) => {
        disk = entries
      },
      remove
    })
    const removing = store.remove('host-a')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    await store.hydrate('host-a')

    expect(load).not.toHaveBeenCalled()
    removal.resolve()
    await removing
    expect(store.get('host-a')).toEqual([])
    expect(disk).toEqual([])
  })

  it('does not reload a tombstoned host after removal', async () => {
    const load = vi.fn(async () => [entry(1)])
    const save = vi.fn(async () => {})
    const store = createConnectionLogStore(200, { load, save, remove: async () => {} })
    await store.remove('host-a')
    await store.hydrate('host-a')

    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.get('host-a')).toEqual([])
  })

  it('invalidates a pending hydration without making deletion wait for the read', async () => {
    const loaded = deferred<readonly ConnectionLogEntry[]>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const store = createConnectionLogStore(200, {
      load: () => loaded.promise,
      save: async (_hostId, entries) => {
        disk = entries
      },
      remove: async () => {
        disk = []
      }
    })
    const hydrating = store.hydrate('host-a')
    await store.remove('host-a')
    store.activate('host-a')
    store.append('host-a', entry(2))
    loaded.resolve([entry(1)])
    await hydrating

    expect(store.get('host-a')).toEqual([entry(2)])
    await vi.waitFor(() => expect(disk).toEqual([entry(2)]))
  })

  it('orders deletion between an in-flight old save and new-session saves', async () => {
    const saving = deferred<void>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const save = vi.fn(async (_hostId: string, entries: readonly ConnectionLogEntry[]) => {
      if (entries[0]?.id === 'log-1') {
        await saving.promise
      }
      disk = entries
    })
    const remove = vi.fn(async () => {
      disk = []
    })
    const store = createConnectionLogStore(200, { load: async () => disk, save, remove })
    await store.hydrate('host-a')
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const removing = store.remove('host-a')
    store.activate('host-a')
    store.append('host-a', entry(2))
    expect(remove).not.toHaveBeenCalled()
    saving.resolve()
    await removing

    expect(store.get('host-a')).toEqual([entry(2)])
    await vi.waitFor(() => expect(disk).toEqual([entry(2)]))
    expect(remove).toHaveBeenCalledOnce()
  })

  it('keeps a new session if deletion of the previous session fails', async () => {
    const removal = deferred<void>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const remove = vi.fn(() => removal.promise)
    const store = createConnectionLogStore(200, {
      load: async () => disk,
      save: async (_hostId, entries) => {
        disk = entries
      },
      remove
    })
    await store.hydrate('host-a')
    const removing = store.remove('host-a')
    const failure = expect(removing).rejects.toThrow('storage unavailable')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    store.activate('host-a')
    store.append('host-a', entry(2))
    removal.reject(new Error('storage unavailable'))
    await failure

    expect(store.get('host-a')).toEqual([entry(2)])
    await vi.waitFor(() => expect(disk).toEqual([entry(2)]))
  })

  it('preserves previously queued saves if removal fails', async () => {
    const saving = deferred<void>()
    let disk: readonly ConnectionLogEntry[] = [entry(1)]
    const save = vi.fn(async (_hostId: string, entries: readonly ConnectionLogEntry[]) => {
      await saving.promise
      disk = entries
    })
    const store = createConnectionLogStore(200, {
      load: async () => disk,
      save,
      remove: async () => {
        throw new Error('storage unavailable')
      }
    })
    await store.hydrate('host-a')
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    store.append('host-a', entry(2))
    await Promise.resolve()
    const removing = store.remove('host-a')
    const failure = expect(removing).rejects.toThrow('storage unavailable')
    saving.resolve()
    await failure

    expect(store.get('host-a')).toEqual([entry(1), entry(2)])
    expect(disk).toEqual([entry(1), entry(2)])
  })

  it('separately removes a second session activated during an earlier deletion', async () => {
    const firstRemoval = deferred<void>()
    const secondRemoval = deferred<void>()
    const remove = vi
      .fn()
      .mockReturnValueOnce(firstRemoval.promise)
      .mockReturnValueOnce(secondRemoval.promise)
    const store = createConnectionLogStore(200, {
      load: async () => [],
      save: async () => {},
      remove
    })
    const first = store.remove('host-a')
    expect(store.remove('host-a')).toBe(first)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    store.activate('host-a')
    store.append('host-a', entry(2))
    const second = store.remove('host-a')
    expect(second).not.toBe(first)
    firstRemoval.resolve()
    await first
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    store.activate('host-a')
    store.append('host-a', entry(3))
    secondRemoval.resolve()
    await second

    expect(store.get('host-a')).toEqual([entry(3)])
  })
})
