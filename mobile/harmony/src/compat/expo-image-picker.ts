import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

const grantedPermission = {
  canAskAgain: true,
  expires: 'never',
  granted: true,
  status: 'granted'
}

export async function requestMediaLibraryPermissionsAsync() {
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
    return { assets: [], canceled: true }
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
      mimeType: asset.mimeType,
      uri: asset.uri
    })),
    canceled: assets.length === 0
  }
}
