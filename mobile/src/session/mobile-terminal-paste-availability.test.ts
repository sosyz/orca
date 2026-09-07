import { describe, expect, it } from 'vitest'
import { shouldOfferMobileTerminalPaste } from './mobile-terminal-paste-availability'

describe('mobile terminal paste availability', () => {
  it('keeps the explicit Harmony paste action available before permission is granted', () => {
    expect(shouldOfferMobileTerminalPaste('harmony', false, false)).toBe(true)
  })

  it('uses passive clipboard availability on platforms that can inspect it', () => {
    expect(shouldOfferMobileTerminalPaste('ios', true, false)).toBe(true)
    expect(shouldOfferMobileTerminalPaste('android', false, true)).toBe(true)
    expect(shouldOfferMobileTerminalPaste('ios', false, false)).toBe(false)
  })
})
