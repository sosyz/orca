import { composeWorktreeHostIdentity } from '../../../src/shared/worktree/host-qualified-identity'
import type { Worktree } from './workspace-list-types'

type WorktreeRowIdentitySource = Pick<Worktree, 'worktreeId' | 'hostId'>

export function getWorktreeRowIdentity(row: WorktreeRowIdentitySource): string {
  return composeWorktreeHostIdentity(row.hostId, row.worktreeId)
}

export function isSameWorktreeRow(
  a: WorktreeRowIdentitySource,
  b: WorktreeRowIdentitySource
): boolean {
  return getWorktreeRowIdentity(a) === getWorktreeRowIdentity(b)
}

/** Drops only the removed row, leaving a same-id workspace on another host visible. */
export function removeWorktreeRow(
  list: readonly Worktree[],
  removed: WorktreeRowIdentitySource
): Worktree[] {
  return list.filter((entry) => !isSameWorktreeRow(entry, removed))
}

export function restoreWorktreeRow(list: readonly Worktree[], item: Worktree): Worktree[] {
  return list.some((entry) => isSameWorktreeRow(entry, item)) ? [...list] : [...list, item]
}

export function clearConfirmedActiveWorktreeIdentity(
  pending: string | null,
  confirmed: readonly Worktree[]
): string | null {
  return pending && confirmed.some((w) => getWorktreeRowIdentity(w) === pending && w.isActive)
    ? null
    : pending
}

export function clearSleptWorktreeOverridesAfterSnapshot(previous: Set<string>): Set<string> {
  return previous.size === 0 ? previous : new Set()
}

export function applyWorktreeRowDisplayState(
  base: Worktree[],
  sleptIds: ReadonlySet<string>,
  optimisticActiveIdentity: string | null
): Worktree[] {
  if (sleptIds.size === 0 && optimisticActiveIdentity === null) {
    return base
  }
  return base.map((w) => {
    const slept = sleptIds.has(getWorktreeRowIdentity(w))
      ? { liveTerminalCount: 0, hasAttachedPty: false, status: 'inactive' as const }
      : null
    const active =
      optimisticActiveIdentity !== null
        ? { isActive: getWorktreeRowIdentity(w) === optimisticActiveIdentity }
        : null
    return slept || active ? { ...w, ...slept, ...active } : w
  })
}
