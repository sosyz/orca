import { describe, expect, it } from 'vitest'
import { appendMobileTaskDetailComment } from './mobile-task-detail-comment-result'

describe('mobile task detail comment result', () => {
  it('appends only to the same provider and does not duplicate a response', () => {
    const detail = { provider: 'github', comments: [{ id: 'existing', body: 'Earlier' }] }
    const comment = { id: 'new', body: 'Now' }
    expect(appendMobileTaskDetailComment(detail, 'gitlab', comment)).toBe(detail)
    const updated = appendMobileTaskDetailComment(detail, 'github', comment)
    expect(updated?.comments).toEqual([...detail.comments, comment])
    expect(appendMobileTaskDetailComment(updated, 'github', comment)).toBe(updated)
  })
})
