import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTerminalTextScale, saveTerminalTextScale } from './preferences'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('terminal text size persistence', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
  })

  it('persists rapid selections in order and waits for the latest before remount reads', async () => {
    let stored = '1'
    const oldWrite = deferred()
    vi.mocked(AsyncStorage.getItem).mockImplementation(async () => stored)
    vi.mocked(AsyncStorage.setItem)
      .mockImplementationOnce(async (_key, value) => {
        await oldWrite.promise
        stored = value
      })
      .mockImplementation(async (_key, value) => {
        stored = value
      })

    const older = saveTerminalTextScale(1.25)
    await Promise.resolve()
    const newer = saveTerminalTextScale(1.5)
    const reloaded = loadTerminalTextScale()

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    oldWrite.resolve()
    await Promise.all([older, newer])
    await expect(reloaded).resolves.toBe(1.5)
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(1, 'orca:terminalTextScale', '1.25')
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(2, 'orca:terminalTextScale', '1.5')
  })

  it('allows a newer selection after an older save fails', async () => {
    let stored = '1'
    vi.mocked(AsyncStorage.getItem).mockImplementation(async () => stored)
    vi.mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockImplementation(async (_key, value) => {
        stored = value
      })

    const failed = expect(saveTerminalTextScale(1.25)).rejects.toThrow('Storage unavailable')
    const latest = saveTerminalTextScale(1.5)
    await failed
    await latest
    await expect(loadTerminalTextScale()).resolves.toBe(1.5)
  })
})
