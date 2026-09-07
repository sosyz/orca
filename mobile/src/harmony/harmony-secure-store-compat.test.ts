import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  deleteItemAsync,
  getItemAsync,
  setItemAsync
} from '../../harmony/src/compat/expo-secure-store'

const native = vi.hoisted(() => ({
  available: true,
  deleteSecureValue: vi.fn<(key: string) => Promise<void>>(),
  getSecureValue: vi.fn<(key: string) => Promise<string | null>>(),
  setSecureValue: vi.fn<(key: string, value: string) => Promise<void>>()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: native,
  hasHarmonyNativeModule: () => native.available
}))

describe('Harmony secure-store compatibility adapter', () => {
  beforeEach(() => {
    native.available = true
    native.deleteSecureValue.mockReset().mockResolvedValue()
    native.getSecureValue.mockReset().mockResolvedValue('stored')
    native.setSecureValue.mockReset().mockResolvedValue()
  })

  it('supports device-only unlocked storage with keychain-service scoping', async () => {
    const options = {
      keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: 'pairing'
    }

    await setItemAsync('token', 'secret', options)
    await expect(getItemAsync('token', options)).resolves.toBe('stored')
    await deleteItemAsync('token', options)

    expect(native.setSecureValue).toHaveBeenCalledWith('pairing:token', 'secret')
    expect(native.getSecureValue).toHaveBeenCalledWith('pairing:token')
    expect(native.deleteSecureValue).toHaveBeenCalledWith('pairing:token')
  })

  it('fails closed for accessibility modes without a Harmony equivalent', async () => {
    await expect(
      setItemAsync('token', 'secret', { keychainAccessible: 'AFTER_FIRST_UNLOCK' })
    ).rejects.toThrow('does not support AFTER_FIRST_UNLOCK')
    expect(native.setSecureValue).not.toHaveBeenCalled()
  })

  it('distinguishes a missing native module from an absent secure value', async () => {
    native.getSecureValue.mockResolvedValueOnce(null)
    await expect(getItemAsync('token')).resolves.toBeNull()

    native.available = false
    await expect(getItemAsync('token')).rejects.toThrow('Harmony secure storage is unavailable')
    await expect(deleteItemAsync('token')).rejects.toThrow('Harmony secure storage is unavailable')
  })
})
