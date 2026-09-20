import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'
import { createHarmonyPickedImagePreview } from './harmony-picked-image-preview'

export async function getDocumentAsync(options?: {
  copyToCacheDirectory?: boolean
  multiple?: boolean
  type?: string | string[]
}) {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony document picker is unavailable')
  }
  const assets = await HarmonyNative.openFilePicker('document', options?.multiple === true)
  return {
    assets: assets.map((asset) => ({
      isTemporary: true,
      getPreviewUri: createHarmonyPickedImagePreview(asset.uri),
      mimeType: asset.mimeType,
      name: asset.fileName ?? 'image',
      size: asset.fileSize,
      uri: asset.uri
    })),
    canceled: assets.length === 0
  }
}
