import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export async function getDocumentAsync(options?: {
  copyToCacheDirectory?: boolean
  multiple?: boolean
  type?: string | string[]
}) {
  if (!hasHarmonyNativeModule()) {
    return { assets: [], canceled: true }
  }
  const assets = await HarmonyNative.openFilePicker('document', options?.multiple === true)
  return {
    assets: assets.map((asset) => ({
      isTemporary: true,
      mimeType: asset.mimeType,
      name: asset.fileName ?? 'image',
      size: asset.fileSize,
      uri: asset.uri
    })),
    canceled: assets.length === 0
  }
}
