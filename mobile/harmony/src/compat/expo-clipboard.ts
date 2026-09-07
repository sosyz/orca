import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export async function setStringAsync(value: string): Promise<void> {
  await HarmonyNative.setClipboardString(value)
}

export async function getStringAsync(): Promise<string> {
  return HarmonyNative.getClipboardString()
}

export async function hasStringAsync(): Promise<boolean> {
  return hasHarmonyNativeModule() && HarmonyNative.hasClipboardString()
}

export async function hasImageAsync(): Promise<boolean> {
  return hasHarmonyNativeModule() && HarmonyNative.hasClipboardImage()
}

export async function getImageAsync(_options?: {
  format?: string
}): Promise<{ data: string; size: { height: number; width: number } } | null> {
  return HarmonyNative.getClipboardImage()
}
