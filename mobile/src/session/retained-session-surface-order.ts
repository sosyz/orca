type ResolveRetainedSessionSurfaceIdsArgs = {
  activeId: string | null
  liveIds: ReadonlySet<string>
  previousIds: readonly string[]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function resolveRetainedSessionSurfaceIds({
  activeId,
  liveIds,
  previousIds
}: ResolveRetainedSessionSurfaceIdsArgs): readonly string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const id of previousIds) {
    if (!liveIds.has(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    next.push(id)
  }
  if (activeId && liveIds.has(activeId) && !seen.has(activeId)) {
    next.push(activeId)
  }
  return sameIds(previousIds, next) ? previousIds : next
}
