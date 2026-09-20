export function closeTaskItemOnOwnedStatusResult<T extends { key: string }>(
  current: T | null,
  targetKey: string,
  sourceCurrent: boolean
): T | null {
  return sourceCurrent && current?.key === targetKey ? null : current
}
