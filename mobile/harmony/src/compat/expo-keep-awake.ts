import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export async function activateKeepAwakeAsync(tag = 'default'): Promise<void> {
  if (hasHarmonyNativeModule()) {
    await HarmonyNative.activateKeepAwake(tag)
  }
}

export async function deactivateKeepAwake(tag = 'default'): Promise<void> {
  if (hasHarmonyNativeModule()) {
    await HarmonyNative.deactivateKeepAwake(tag)
  }
}
