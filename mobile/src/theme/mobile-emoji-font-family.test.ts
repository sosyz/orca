import { describe, expect, it } from 'vitest'
import { mobileEmojiFontFamily, mobileEmojiTextStyle } from './mobile-emoji-font-family'
import {
  mobileEmojiFontFamily as harmonyEmojiFontFamily,
  mobileEmojiTextStyle as harmonyEmojiTextStyle
} from './mobile-emoji-font-family.harmony'

describe('mobile emoji font family', () => {
  it('leaves default mobile platforms on their native emoji fallback', () => {
    expect(mobileEmojiFontFamily).toBeUndefined()
    expect(mobileEmojiTextStyle).toEqual({})
  })

  it('uses the single registered Harmony native emoji face', () => {
    expect(harmonyEmojiFontFamily).toBe('Orca Emoji')
    expect(harmonyEmojiFontFamily).not.toContain(',')
    expect(harmonyEmojiTextStyle).toEqual({ fontFamily: 'Orca Emoji' })
  })
})
