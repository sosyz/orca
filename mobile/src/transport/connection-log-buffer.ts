import type { ConnectionLogEntry } from './types'
import { redactConnectionLogEntry } from '../diagnostics/connection-log-redaction'

// Why: the rpc-client's onLog entries were only wired during pairing; for
// long-lived host connections everything went to console.log, invisible to
// users. This buffer retains the recent lifecycle events per host so a
// "Connection log" screen (and copy-diagnostics) can show why a connection
// is stuck without a debug build. Module-level so the log survives client
// swaps (forceReconnect) and provider remounts (hot reload); bounded so an
// all-night reconnect loop can't grow memory unbounded.
const MAX_ENTRIES_PER_HOST = 200

export type ConnectionLogStore = {
  append: (hostId: string, entry: ConnectionLogEntry) => void
  get: (hostId: string) => readonly ConnectionLogEntry[]
  hydrate: (hostId: string) => Promise<void>
  remove: (hostId: string) => Promise<void>
  activate: (hostId: string) => void
  subscribe: (hostId: string, listener: () => void) => () => void
}

export type ConnectionLogPersistence = {
  load: (hostId: string) => Promise<readonly ConnectionLogEntry[]>
  save: (hostId: string, entries: readonly ConnectionLogEntry[]) => Promise<void>
  remove?: (hostId: string) => Promise<void>
}

export function createConnectionLogStore(
  maxEntriesPerHost: number = MAX_ENTRIES_PER_HOST,
  persistence?: ConnectionLogPersistence
): ConnectionLogStore {
  const entriesByHost = new Map<string, ConnectionLogEntry[]>()
  const listenersByHost = new Map<string, Set<() => void>>()
  const hydratedHosts = new Set<string>()
  const hydrationFailedHosts = new Set<string>()
  const hydrationByHost = new Map<string, Promise<void>>()
  const saveByHost = new Map<string, Promise<void>>()
  const removalByHost = new Map<string, Promise<void>>()
  const generationByHost = new Map<string, number>()
  // A closed host can still deliver one queued log callback. Keep its log
  // tombstoned until a new client session explicitly activates the host.
  const removedHosts = new Set<string>()
  // Why: useSyncExternalStore compares snapshots by reference — getSnapshot
  // must return the SAME array until the data actually changes, or React
  // loops re-rendering. Cache per host; invalidate on append.
  const snapshotByHost = new Map<string, readonly ConnectionLogEntry[]>()
  const EMPTY: readonly ConnectionLogEntry[] = []
  const generation = (hostId: string): number => generationByHost.get(hostId) ?? 0
  const advanceGeneration = (hostId: string): number => {
    const next = generation(hostId) + 1
    generationByHost.set(hostId, next)
    hydrationByHost.delete(hostId)
    return next
  }

  const trim = (entries: ConnectionLogEntry[]): void => {
    if (entries.length > maxEntriesPerHost) {
      entries.splice(0, entries.length - maxEntriesPerHost)
    }
  }

  const notify = (hostId: string): void => {
    snapshotByHost.delete(hostId)
    const listeners = listenersByHost.get(hostId)
    if (listeners) {
      for (const listener of listeners) {
        listener()
      }
    }
  }

  const persist = (hostId: string): void => {
    if (!persistence || !hydratedHosts.has(hostId) || removedHosts.has(hostId)) {
      return
    }
    const snapshot = [...(entriesByHost.get(hostId) ?? [])]
    const previous = saveByHost.get(hostId) ?? Promise.resolve()
    const pending = previous
      .catch(() => {})
      .then(async () => {
        try {
          await persistence.save(hostId, snapshot)
        } catch {
          await persistence.save(hostId, snapshot)
        }
      })
      .catch(() => {})
    saveByHost.set(hostId, pending)
  }

  const hydrateHost = async (hostId: string, retryAfterFailure: boolean): Promise<void> => {
    if (!persistence || hydratedHosts.has(hostId) || removedHosts.has(hostId)) {
      return
    }
    const existing = hydrationByHost.get(hostId)
    if (existing) {
      return existing
    }
    if (!retryAfterFailure && hydrationFailedHosts.has(hostId)) {
      return
    }
    const owner = generation(hostId)
    const pending = persistence
      .load(hostId)
      .then((stored) => {
        if (generation(hostId) !== owner) {
          return
        }
        const live = entriesByHost.get(hostId) ?? []
        const seen = new Set<string>()
        const merged: ConnectionLogEntry[] = []
        for (const entry of [...stored, ...live]) {
          const redacted = redactConnectionLogEntry(entry)
          const fingerprint = JSON.stringify(redacted)
          if (!seen.has(fingerprint)) {
            seen.add(fingerprint)
            merged.push(redacted)
          }
        }
        merged.sort((a, b) => a.ts - b.ts)
        trim(merged)
        entriesByHost.set(hostId, merged)
        hydratedHosts.add(hostId)
        hydrationFailedHosts.delete(hostId)
        notify(hostId)
        persist(hostId)
      })
      .catch((error: unknown) => {
        if (generation(hostId) !== owner) {
          return
        }
        hydrationFailedHosts.add(hostId)
        throw error
      })
      .finally(() => {
        if (hydrationByHost.get(hostId) === pending) {
          hydrationByHost.delete(hostId)
        }
      })
    hydrationByHost.set(hostId, pending)
    return pending
  }

  return {
    activate(hostId) {
      if (removedHosts.delete(hostId)) {
        advanceGeneration(hostId)
        entriesByHost.delete(hostId)
        hydrationFailedHosts.delete(hostId)
        // The queued deletion owns previous history; fresh saves follow it.
        hydratedHosts.add(hostId)
        notify(hostId)
      }
    },

    append(hostId, entry) {
      if (removedHosts.has(hostId)) {
        return
      }
      let entries = entriesByHost.get(hostId)
      if (!entries) {
        entries = []
        entriesByHost.set(hostId, entries)
      }
      entries.push(redactConnectionLogEntry(entry))
      trim(entries)
      notify(hostId)
      void hydrateHost(hostId, false)
        .then(() => persist(hostId))
        .catch(() => {})
    },

    get(hostId) {
      const cached = snapshotByHost.get(hostId)
      if (cached) {
        return cached
      }
      const entries = entriesByHost.get(hostId)
      if (!entries || entries.length === 0) {
        return EMPTY
      }
      const snapshot = Object.freeze([...entries])
      snapshotByHost.set(hostId, snapshot)
      return snapshot
    },

    hydrate: (hostId) => hydrateHost(hostId, true),

    remove(hostId) {
      const existing = removalByHost.get(hostId)
      if (existing && removedHosts.has(hostId)) {
        return existing
      }

      removedHosts.add(hostId)
      const owner = advanceGeneration(hostId)
      const previousSave = saveByHost.get(hostId) ?? Promise.resolve()
      const removal = (async () => {
        try {
          await previousSave.catch(() => {})
          if (persistence) {
            if (persistence.remove) {
              await persistence.remove(hostId)
            } else {
              // Empty storage is equivalent for older persistence adapters.
              await persistence.save(hostId, [])
            }
          }
        } catch (error) {
          if (generation(hostId) === owner) {
            removedHosts.delete(hostId)
          }
          throw error
        }

        if (generation(hostId) !== owner) {
          return
        }
        entriesByHost.delete(hostId)
        snapshotByHost.delete(hostId)
        hydratedHosts.delete(hostId)
        hydrationFailedHosts.delete(hostId)
        notify(hostId)
      })().finally(() => {
        if (removalByHost.get(hostId) === removal) {
          removalByHost.delete(hostId)
        }
        if (saveByHost.get(hostId) === removal) {
          saveByHost.delete(hostId)
        }
      })
      saveByHost.set(hostId, removal)
      removalByHost.set(hostId, removal)
      return removal
    },

    subscribe(hostId, listener) {
      let listeners = listenersByHost.get(hostId)
      if (!listeners) {
        listeners = new Set()
        listenersByHost.set(hostId, listeners)
      }
      listeners.add(listener)
      return () => {
        const set = listenersByHost.get(hostId)
        if (!set) {
          return
        }
        set.delete(listener)
        if (set.size === 0) {
          listenersByHost.delete(hostId)
        }
      }
    }
  }
}
