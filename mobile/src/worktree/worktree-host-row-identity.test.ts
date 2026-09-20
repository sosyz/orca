import { describe, expect, it } from 'vitest'
import {
  applyWorktreeRowDisplayState,
  clearConfirmedActiveWorktreeIdentity,
  clearSleptWorktreeOverridesAfterSnapshot,
  getWorktreeRowIdentity,
  removeWorktreeRow,
  restoreWorktreeRow
} from './worktree-host-row-identity'
import type { Worktree } from './workspace-list-types'

function row(worktreeId: string, hostId: string, overrides: Partial<Worktree> = {}): Worktree {
  return { worktreeId, hostId, displayName: worktreeId, ...overrides } as Worktree
}

describe('removeWorktreeRow', () => {
  // Deleting on one host used to clear the other host's identically-named row from the list.
  it('keeps a same-id workspace that lives on another host', () => {
    const local = row('shared', 'host-a')
    const remote = row('shared', 'host-b')

    expect(removeWorktreeRow([local, remote], local)).toEqual([remote])
  })

  it('removes the matching row', () => {
    const only = row('shared', 'host-a')

    expect(removeWorktreeRow([only], only)).toEqual([])
  })
})

describe('restoreWorktreeRow', () => {
  it('does not duplicate a row restored by an older poll, preserving same-id rows on other hosts', () => {
    const local = row('shared', 'host-a')
    const remote = row('shared', 'host-b')

    expect(restoreWorktreeRow([local, remote], local)).toEqual([local, remote])
    expect(restoreWorktreeRow([remote], local)).toEqual([remote, local])
  })
})

describe('getWorktreeRowIdentity', () => {
  it('uses the shared host-qualified identity format', () => {
    expect(getWorktreeRowIdentity(row('shared', 'ssh:builder'))).toBe('ssh:builder|shared')
  })
})

describe('host-qualified row display state', () => {
  it('clears the optimistic active row only when the same host confirms it', () => {
    const pending = getWorktreeRowIdentity(row('shared', 'host-a'))

    expect(
      clearConfirmedActiveWorktreeIdentity(pending, [row('shared', 'host-b', { isActive: true })])
    ).toBe(pending)
    expect(
      clearConfirmedActiveWorktreeIdentity(pending, [row('shared', 'host-a', { isActive: true })])
    ).toBeNull()
  })

  it('releases optimistic sleep when the host confirms a still-live row', () => {
    const local = row('shared', 'host-a')
    const remote = row('shared', 'host-b')
    const retained = clearSleptWorktreeOverridesAfterSnapshot(
      new Set([getWorktreeRowIdentity(local), getWorktreeRowIdentity(remote)])
    )

    expect([...retained]).toEqual([])
  })

  it('preserves the empty override set to avoid an unnecessary state update', () => {
    const empty = new Set<string>()
    expect(clearSleptWorktreeOverridesAfterSnapshot(empty)).toBe(empty)
  })

  it('applies active and slept overrides to the matching host row only', () => {
    const local = row('shared', 'host-a')
    const remote = row('shared', 'host-b')

    const rows = applyWorktreeRowDisplayState(
      [local, remote],
      new Set([getWorktreeRowIdentity(local)]),
      getWorktreeRowIdentity(remote)
    )

    expect(rows).toMatchObject([
      { hostId: 'host-a', liveTerminalCount: 0, status: 'inactive', isActive: false },
      { hostId: 'host-b', isActive: true }
    ])
  })
})
