import { describe, expect, it } from 'vitest'
import {
  advanceNativeChatPromptIdentity as advance,
  nativeChatPromptIdentityKey as key
} from './native-chat-prompt-identity'

describe('native chat prompt identity', () => {
  it('keeps presentation stable when metadata arrives, disappears, or replays', () => {
    const unknown = advance(null, 'same-content')
    const identified = advance(unknown, 'same-content', 'a')
    expect(key(identified)).toBe(key(unknown))
    expect(advance(identified, 'same-content')).toBe(identified)
    expect(advance(identified, 'same-content', 'a')).toBe(identified)
    expect(key(advance(identified, 'same-content', 'b'))).not.toBe(key(identified))
  })

  it('starts a new presentation on content changes and after an observable clear', () => {
    const first = advance(null, 'old', 'a')
    const changed = advance(first, 'new', 'a')
    expect(key(changed)).not.toBe(key(first))
    const cleared = advance(changed, null)
    expect(key(cleared)).toBeNull()
    expect(cleared.requestKey).toBeUndefined()
    expect(key(advance(cleared, 'old', 'a'))).not.toBe(key(first))
  })
})
