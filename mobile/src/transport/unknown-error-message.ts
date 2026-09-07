export function formatUnknownErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    return error.trim() || fallback
  }
  if (error === null || typeof error !== 'object') {
    return fallback
  }
  try {
    const message = Reflect.get(error, 'message') as unknown
    return typeof message === 'string' && message.trim() ? message.trim() : fallback
  } catch {
    return fallback
  }
}
