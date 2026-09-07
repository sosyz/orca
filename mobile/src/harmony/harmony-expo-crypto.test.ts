import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRandomBytes } from '../../harmony/src/compat/expo-crypto'

const native = vi.hoisted(() => ({
  available: true,
  randomBytes: vi.fn<(length: number) => number[]>()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: { randomBytes: native.randomBytes },
  hasHarmonyNativeModule: () => native.available
}))

describe('Harmony expo-crypto adapter', () => {
  beforeEach(() => {
    native.available = true
    native.randomBytes.mockReset()
    native.randomBytes.mockImplementation((length) =>
      Array.from({ length }, (_value, index) => index)
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects byte counts outside the Expo 0...1024 contract', () => {
    for (const value of [Number.NaN, -1, 1025, Number.POSITIVE_INFINITY, '4']) {
      expect(() => getRandomBytes(value as number)).toThrow(TypeError)
    }
    expect(native.randomBytes).not.toHaveBeenCalled()
  })

  it('floors a valid fractional byte count before calling native', () => {
    expect(getRandomBytes(3.9)).toEqual(Uint8Array.from([0, 1, 2]))
    expect(native.randomBytes).toHaveBeenCalledWith(3)

    getRandomBytes(1024.9)
    expect(native.randomBytes).toHaveBeenLastCalledWith(1024)
  })

  it('uses the platform secure random source when native is unavailable', () => {
    native.available = false
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(7)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(getRandomBytes(4)).toEqual(Uint8Array.from([7, 7, 7, 7]))
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('fails closed when no secure random source exists', () => {
    native.available = false
    vi.stubGlobal('crypto', undefined)

    expect(() => getRandomBytes(16)).toThrow('secure random number generation is unavailable')
  })
})
