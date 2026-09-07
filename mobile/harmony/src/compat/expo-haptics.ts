import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'

export const AndroidHaptics = {
  Clock_Tick: 'clock-tick',
  Confirm: 'confirm',
  Gesture_Start: 'gesture-start',
  Long_Press: 'long-press',
  Reject: 'reject'
} as const

export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium' } as const

export const NotificationFeedbackType = { Error: 'error', Success: 'success' } as const

async function vibrate(kind: string): Promise<void> {
  if (hasHarmonyNativeModule()) {
    await HarmonyNative.vibrate(kind)
  }
}

export const performAndroidHapticsAsync = vibrate

export const impactAsync = vibrate

export const notificationAsync = vibrate

export const selectionAsync = () => vibrate('selection')
