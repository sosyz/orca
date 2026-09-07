import { HarmonyNative } from '../native/harmony-native-module'

export const SaveFormat = { PNG: 'png' } as const

export const ImageManipulator = {
  manipulate(uri: string) {
    let target = { height: 0, width: 0 }
    return {
      release: () => undefined,
      resize(next: { height: number; width: number }) {
        target = next
      },
      async renderAsync() {
        return {
          release: () => undefined,
          saveAsync: async (_options?: { base64?: boolean; format?: string }) =>
            HarmonyNative.manipulateImage(uri, target.width, target.height)
        }
      }
    }
  }
}
