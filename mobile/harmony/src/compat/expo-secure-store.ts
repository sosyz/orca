import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'

export type SecureStoreOptions = { keychainService?: string; keychainAccessible?: string }

function scopedKey(key: string, options?: SecureStoreOptions): string {
  const accessibility = options?.keychainAccessible
  if (accessibility && accessibility !== WHEN_UNLOCKED_THIS_DEVICE_ONLY) {
    throw new Error(`Harmony secure storage does not support ${accessibility}`)
  }
  return `${options?.keychainService ?? 'default'}:${key}`
}

export async function setItemAsync(
  key: string,
  value: string,
  options?: SecureStoreOptions
): Promise<void> {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony secure storage is unavailable')
  }
  await HarmonyNative.setSecureValue(scopedKey(key, options), value)
}

export async function getItemAsync(
  key: string,
  options?: SecureStoreOptions
): Promise<string | null> {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony secure storage is unavailable')
  }
  return HarmonyNative.getSecureValue(scopedKey(key, options))
}

export async function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony secure storage is unavailable')
  }
  await HarmonyNative.deleteSecureValue(scopedKey(key, options))
}
