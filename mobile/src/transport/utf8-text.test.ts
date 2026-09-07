import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeUtf8Text } from './utf8-text'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decodeUtf8Text', () => {
  it('decodes UTF-8 without a runtime TextDecoder', () => {
    vi.stubGlobal('TextDecoder', undefined)

    expect(
      decodeUtf8Text(
        Uint8Array.from([
          0x4f, 0x72, 0x63, 0x61, 0x20, 0xc3, 0xa9, 0x20, 0xe4, 0xb8, 0xad, 0x20, 0xf0, 0x9f, 0x90,
          0x8b
        ])
      )
    ).toBe('Orca é 中 🐋')
  })

  it('matches TextDecoder replacement and BOM behavior', () => {
    const samples = [
      [0xef, 0xbb, 0xbf, 0x61],
      [0xe2, 0x82],
      [0xe2, 0x82, 0x41],
      [0xc0, 0xaf],
      [0xf4, 0x90, 0x80, 0x80]
    ].map((sample) => Uint8Array.from(sample))
    const expected = samples.map((sample) => new TextDecoder().decode(sample))

    vi.stubGlobal('TextDecoder', undefined)

    expect(samples.map(decodeUtf8Text)).toEqual(expected)
  })
})
