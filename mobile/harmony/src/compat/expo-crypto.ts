import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export function getRandomBytes(length: number): Uint8Array {
  if (
    typeof length !== 'number' ||
    Number.isNaN(length) ||
    Math.floor(length) < 0 ||
    Math.floor(length) > 1024
  ) {
    throw new TypeError(
      `expo-crypto: getRandomBytes(${length}) expected a valid number from range 0...1024`
    )
  }
  const byteCount = Math.floor(length)
  if (hasHarmonyNativeModule()) {
    return Uint8Array.from(HarmonyNative.randomBytes(byteCount))
  }
  const crypto = globalThis.crypto
  const secureRandom = crypto?.getRandomValues
  if (typeof secureRandom !== 'function') {
    throw new Error('expo-crypto: secure random number generation is unavailable')
  }
  const bytes = new Uint8Array(byteCount)
  secureRandom.call(crypto, bytes)
  return bytes
}

export function randomUUID(): string {
  const bytes = getRandomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
