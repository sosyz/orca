import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  available: true,
  getClipboardImage:
    vi.fn<() => Promise<{ data: string; size: { height: number; width: number } } | null>>(),
  getClipboardString: vi.fn<() => Promise<string>>(),
  hasClipboardImage: vi.fn<() => Promise<boolean>>(),
  hasClipboardString: vi.fn<() => Promise<boolean>>(),
  setClipboardString: vi.fn<(value: string) => Promise<void>>()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: new Proxy({} as typeof native, {
    get(_target, property) {
      if (!native.available) {
        throw new Error('OrcaHarmony native module is unavailable')
      }
      return Reflect.get(native, property)
    }
  }),
  hasHarmonyNativeModule: () => native.available
}))

import {
  getImageAsync,
  getStringAsync,
  hasImageAsync,
  hasStringAsync,
  setStringAsync
} from '../../harmony/src/compat/expo-clipboard'

describe('Harmony expo-clipboard compatibility adapter', () => {
  beforeEach(() => {
    native.available = true
    native.getClipboardImage.mockReset().mockResolvedValue(null)
    native.getClipboardString.mockReset().mockResolvedValue('')
    native.hasClipboardImage.mockReset().mockResolvedValue(false)
    native.hasClipboardString.mockReset().mockResolvedValue(false)
    native.setClipboardString.mockReset().mockResolvedValue()
  })

  it('distinguishes an unavailable native module from real empty clipboard results', async () => {
    await expect(getStringAsync()).resolves.toBe('')
    await expect(getImageAsync()).resolves.toBeNull()
    await expect(hasStringAsync()).resolves.toBe(false)
    await expect(hasImageAsync()).resolves.toBe(false)

    native.available = false

    await expect(setStringAsync('copy me')).rejects.toThrow(
      'OrcaHarmony native module is unavailable'
    )
    await expect(getStringAsync()).rejects.toThrow('OrcaHarmony native module is unavailable')
    await expect(getImageAsync()).rejects.toThrow('OrcaHarmony native module is unavailable')
    await expect(hasStringAsync()).resolves.toBe(false)
    await expect(hasImageAsync()).resolves.toBe(false)
  })

  it('forwards explicit clipboard writes and reads to native when available', async () => {
    native.getClipboardString.mockResolvedValue('copied')
    native.getClipboardImage.mockResolvedValue({
      data: 'aGVsbG8=',
      size: { height: 1, width: 2 }
    })

    await setStringAsync('copied')

    await expect(getStringAsync()).resolves.toBe('copied')
    await expect(getImageAsync()).resolves.toEqual({
      data: 'aGVsbG8=',
      size: { height: 1, width: 2 }
    })
    expect(native.setClipboardString).toHaveBeenCalledWith('copied')
  })
})
