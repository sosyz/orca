// Why: persist the data needed to render the home page so cold-start /
// resume-from-background paints instantly with the last known good
// values, then updates in place when fresh RPC data arrives. Without
// this, Resume and Account-usage cards flash empty for ~1s while the
// WebSocket reconnects and the first responses come back.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'
import { AccountsSnapshotSchema, type AccountsSnapshot } from '../components/accounts-snapshot'
// Why: the canonical shape, so persisted counts keep carrying countsProvenAt — the home card
// needs it to know whether a rehydrated count is minutes or days old.
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'

const STORAGE_KEY = 'orca:home-snapshot:v1'

export type HomeSnapshot = {
  worktreeInfo: Record<string, HostWorktreeInfo>
  accountsByHost: Record<string, AccountsSnapshot>
  savedAt: number
}

const SnapshotCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const HomeWorktreeSnapshotSchema = z
  .object({
    hostId: z.string(),
    totalWorktrees: SnapshotCount,
    activeCount: SnapshotCount,
    lastActiveWorktree: z
      .object({
        worktreeId: z.string(),
        repo: z.string(),
        branch: z.string(),
        displayName: z.string(),
        liveTerminalCount: SnapshotCount,
        status: z.enum(['working', 'active', 'permission', 'done', 'inactive']).optional(),
        isActive: z.boolean().optional(),
        lastOutputAt: SnapshotCount.optional()
      })
      .passthrough()
      .nullable(),
    catalogUnavailable: z.boolean().optional(),
    staleCounts: z.boolean().optional(),
    countsProvenAt: SnapshotCount.optional()
  })
  .passthrough()
const HomeSnapshotSchema = z.object({
  savedAt: SnapshotCount,
  worktreeInfo: z.record(z.string(), z.unknown()),
  accountsByHost: z.record(z.string(), z.unknown())
})

let memoryCache: HomeSnapshot | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
let writeInFlight: Promise<void> | null = null
let pendingWrite: HomeSnapshot | null = null

export async function loadHomeSnapshot(): Promise<HomeSnapshot | null> {
  if (memoryCache) {
    return memoryCache
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    // A host may publish live data while the cold storage read is still pending.
    if (memoryCache) {
      return memoryCache
    }
    if (!raw) {
      return null
    }
    const parsed = HomeSnapshotSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return null
    }
    // Older account schemas must not discard a still-valid worktree cache.
    const worktreeInfo = Object.fromEntries(
      Object.entries(parsed.data.worktreeInfo).flatMap(([hostId, value]) => {
        const entry = HomeWorktreeSnapshotSchema.safeParse(value)
        return entry.success ? [[hostId, entry.data]] : []
      })
    )
    const accountsByHost = Object.fromEntries(
      Object.entries(parsed.data.accountsByHost).flatMap(([hostId, value]) => {
        const entry = AccountsSnapshotSchema.safeParse(value)
        return entry.success ? [[hostId, entry.data]] : []
      })
    )
    memoryCache = { savedAt: parsed.data.savedAt, worktreeInfo, accountsByHost }
    return memoryCache
  } catch {
    return memoryCache
  }
}

// Why: throttle writes so a flurry of streamed account-snapshot updates
// (one per provider fetch finishing) doesn't hammer AsyncStorage.
export function saveHomeSnapshot(snapshot: HomeSnapshot): void {
  memoryCache = snapshot
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(() => {
    writeTimer = null
    pendingWrite = snapshot
    if (!writeInFlight) {
      writeInFlight = persistPendingSnapshots().finally(() => {
        writeInFlight = null
      })
    }
  }, 250)
}

async function persistPendingSnapshots(): Promise<void> {
  while (pendingWrite) {
    const snapshot = pendingWrite
    pendingWrite = null
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // Cached data remains usable in memory when storage is temporarily unavailable.
    }
  }
}
