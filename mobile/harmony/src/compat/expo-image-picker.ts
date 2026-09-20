import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'
import { createHarmonyPickedImagePreview } from './harmony-picked-image-preview'

const grantedPermission = {
  canAskAgain: true,
  expires: 'never',
  granted: true,
  status: 'granted'
}

export async function requestMediaLibraryPermissionsAsync() {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony image picker is unavailable')
  }
  return grantedPermission
}

export async function launchImageLibraryAsync(options?: {
  allowsMultipleSelection?: boolean
  base64?: boolean
  mediaTypes?: string[]
  orderedSelection?: boolean
  quality?: number
  selectionLimit?: number
}) {
  if (!hasHarmonyNativeModule()) {
    throw new Error('Harmony image picker is unavailable')
  }
  const assets = await HarmonyNative.openFilePicker(
    'image',
    options?.allowsMultipleSelection === true
  )
  return {
    assets: assets.map((asset) => ({
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      isTemporary: true,
      getPreviewUri: createHarmonyPickedImagePreview(asset.uri),
      mimeType: asset.mimeType,
      uri: asset.uri
    })),
    canceled: assets.length === 0
  }
}
