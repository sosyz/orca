import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeSnapshot } from './home-snapshot-cache'

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

function snapshot(count: number): HomeSnapshot {
  return {
    worktreeInfo: {
      host: { hostId: 'host', totalWorktrees: count, activeCount: 0, lastActiveWorktree: null }
    },
    accountsByHost: {},
    savedAt: count
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  storage.getItem.mockReset().mockResolvedValue(null)
  storage.setItem.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('home snapshot cache', () => {
  it.each([
    { worktreeInfo: null, accountsByHost: {}, savedAt: 1 },
    { worktreeInfo: {}, accountsByHost: [], savedAt: 1 }
  ])('discards malformed persisted records before home hydration', async (stored) => {
    storage.getItem.mockResolvedValue(JSON.stringify(stored))
    const { loadHomeSnapshot } = await import('./home-snapshot-cache')
    await expect(loadHomeSnapshot()).resolves.toBeNull()
  })

  it('drops malformed host entries without losing healthy host data', async () => {
    const healthy = snapshot(3)
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        ...healthy,
        worktreeInfo: { ...healthy.worktreeInfo, broken: null },
        accountsByHost: { broken: { claude: null } }
      })
    )
    const { loadHomeSnapshot } = await import('./home-snapshot-cache')
    await expect(loadHomeSnapshot()).resolves.toEqual(healthy)
  })

  it('accepts older count snapshots without a countsProvenAt stamp', async () => {
    const stored = snapshot(3)
    storage.getItem.mockResolvedValue(JSON.stringify(stored))
    const { loadHomeSnapshot } = await import('./home-snapshot-cache')
    await expect(loadHomeSnapshot()).resolves.toEqual(stored)
  })

  it('keeps valid worktree data when a v1 account entry uses the original account shape', async () => {
    const stored = {
      ...snapshot(3),
      accountsByHost: {
        host: {
          claude: { accounts: [], activeAccountId: null },
          codex: {
            accounts: [{ id: 'codex-1', email: 'user@example.com' }],
            activeAccountId: 'codex-1'
          },
          rateLimits: {
            claude: null,
            codex: null,
            inactiveClaudeAccounts: [
              { accountId: 'claude-1', claude: null, updatedAt: 1, isFetching: false }
            ],
            inactiveCodexAccounts: []
          }
        }
      }
    }
    storage.getItem.mockResolvedValue(JSON.stringify(stored))
    const { loadHomeSnapshot } = await import('./home-snapshot-cache')
    await expect(loadHomeSnapshot()).resolves.toEqual({ ...snapshot(3), accountsByHost: {} })
  })

  it('keeps live data when a stale storage read completes after a save', async () => {
    let finishRead!: (value: string) => void
    storage.getItem.mockReturnValue(
      new Promise<string>((resolve) => {
        finishRead = resolve
      })
    )
    const { loadHomeSnapshot, saveHomeSnapshot } = await import('./home-snapshot-cache')
    const reading = loadHomeSnapshot()
    const live = snapshot(8)
    saveHomeSnapshot(live)
    finishRead(JSON.stringify(snapshot(2)))
    await expect(reading).resolves.toBe(live)
    await expect(loadHomeSnapshot()).resolves.toBe(live)
    await vi.advanceTimersByTimeAsync(250)
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual(live)
  })

  it('serializes in-flight writes so a slow older write cannot win on disk', async () => {
    let finishFirst!: () => void
    storage.setItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    )
    const { saveHomeSnapshot } = await import('./home-snapshot-cache')
    saveHomeSnapshot(snapshot(1))
    await vi.advanceTimersByTimeAsync(250)
    saveHomeSnapshot(snapshot(2))
    await vi.advanceTimersByTimeAsync(250)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    finishFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.setItem.mock.calls[1][1])).toEqual(snapshot(2))
  })

  it('coalesces obsolete waiting snapshots behind a slow storage write', async () => {
    let finishFirst!: () => void
    storage.setItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    )
    const { saveHomeSnapshot } = await import('./home-snapshot-cache')
    saveHomeSnapshot(snapshot(1))
    await vi.advanceTimersByTimeAsync(250)
    for (let count = 2; count <= 10; count += 1) {
      saveHomeSnapshot(snapshot(count))
      await vi.advanceTimersByTimeAsync(250)
    }
    finishFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.setItem.mock.calls[1][1])).toEqual(snapshot(10))
  })

  it('returns live data even if the obsolete storage read rejects', async () => {
    let failRead!: (error: Error) => void
    storage.getItem.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        failRead = reject
      })
    )
    const { saveHomeSnapshot, loadHomeSnapshot } = await import('./home-snapshot-cache')
    const reading = loadHomeSnapshot()
    const live = snapshot(3)
    saveHomeSnapshot(live)
    failRead(new Error('storage unavailable'))
    await expect(reading).resolves.toBe(live)
    await vi.advanceTimersByTimeAsync(250)
  })

  it('continues persisting after an earlier storage write fails', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('storage temporarily unavailable'))
    const { saveHomeSnapshot } = await import('./home-snapshot-cache')
    saveHomeSnapshot(snapshot(1))
    await vi.advanceTimersByTimeAsync(250)
    saveHomeSnapshot(snapshot(2))
    await vi.advanceTimersByTimeAsync(250)
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1])).toEqual(snapshot(2))
  })
})
