import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  available: true,
  deleteFile: vi.fn<(uri: string) => void>(),
  fileSize: vi.fn<(uri: string) => number>(),
  readFileBytes: vi.fn<(uri: string, offset: number, length: number) => number[]>(),
  writeFile: vi.fn<(uri: string, data: string, encoding: string) => void>()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: new Proxy({} as typeof native, {
    get(_target, property) {
      if (!native.available) {
        throw new Error('OrcaHarmony native module is unavailable')
      }
      return Reflect.get(native, property)
    }
  })
}))

import { File, Paths } from '../../harmony/src/compat/expo-file-system'

describe('Harmony expo-file-system compatibility adapter', () => {
  beforeEach(() => {
    native.available = true
    native.deleteFile.mockReset()
    native.fileSize.mockReset().mockReturnValue(0)
    native.readFileBytes.mockReset().mockReturnValue([])
    native.writeFile.mockReset()
  })

  it('distinguishes an unavailable native module from a real empty file', () => {
    const file = new File('file://empty.png')

    expect(file.size).toBe(0)
    expect(file.open().readBytes(16)).toEqual(new Uint8Array())

    native.available = false

    expect(() => file.size).toThrow('OrcaHarmony native module is unavailable')
    expect(() => file.create()).toThrow('OrcaHarmony native module is unavailable')
    expect(() => file.open()).toThrow('OrcaHarmony native module is unavailable')
    expect(() => file.write('')).toThrow('OrcaHarmony native module is unavailable')
    expect(() => file.delete()).toThrow('OrcaHarmony native module is unavailable')
  })

  it('advances the native read offset across consecutive handle reads', () => {
    const bytes = [10, 11, 12, 13, 14]
    native.fileSize.mockReturnValue(bytes.length)
    native.readFileBytes.mockImplementation((_uri, offset, length) =>
      bytes.slice(offset, offset + length)
    )

    const file = new File(Paths.cache, 'image.png')
    const handle = file.open()

    expect(handle.size).toBe(5)
    expect(handle.readBytes(2)).toEqual(Uint8Array.from([10, 11]))
    expect(handle.readBytes(2)).toEqual(Uint8Array.from([12, 13]))
    expect(handle.readBytes(2)).toEqual(Uint8Array.from([14]))
    expect(native.readFileBytes.mock.calls).toEqual([
      ['file://orca-cache/image.png', 0, 2],
      ['file://orca-cache/image.png', 2, 2],
      ['file://orca-cache/image.png', 4, 2]
    ])
  })

  it('routes cleanup deletes through native instead of silently succeeding', () => {
    const file = new File(Paths.cache, 'stale.png')

    file.delete()

    expect(native.deleteFile).toHaveBeenCalledWith('file://orca-cache/stale.png')

    native.available = false

    expect(() => file.delete()).toThrow('OrcaHarmony native module is unavailable')
  })
})
