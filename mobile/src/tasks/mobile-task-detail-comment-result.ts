import type { DetailComment } from './mobile-task-comment-rpc'

export function appendMobileTaskDetailComment<
  T extends { provider: string; comments: DetailComment[] }
>(current: T | null, provider: string, comment: DetailComment): T | null {
  if (
    !current ||
    current.provider !== provider ||
    current.comments.some((entry) => entry.id === comment.id)
  ) {
    return current
  }
  return { ...current, comments: [...current.comments, comment] }
}
