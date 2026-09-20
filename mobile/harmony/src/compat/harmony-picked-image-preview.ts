import { HarmonyNative } from '../native/harmony-native-module'

const MAX_PREVIEW_BASE64_CHARS = 1024 * 1024

export function createHarmonyPickedImagePreview(uri: string): () => Promise<string> {
  return async () => {
    const base64 = await HarmonyNative.createImagePreview(uri)
    if (!base64 || base64.length > MAX_PREVIEW_BASE64_CHARS) {
      throw new Error('Harmony image preview is unavailable')
    }
    return `data:image/png;base64,${base64}`
  }
}
