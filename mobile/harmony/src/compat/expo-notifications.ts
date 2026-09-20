import {
  addHarmonyNativeListener,
  HarmonyNative,
  type HarmonyNotificationResponse,
  hasHarmonyNativeModule
} from '../native/harmony-native-module'

export type NotificationResponse = HarmonyNotificationResponse

export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT'

export const AndroidImportance = { HIGH: 4 }

export function setNotificationHandler(_handler: unknown): void {}

export function clearLastNotificationResponse(): void {
  if (hasHarmonyNativeModule()) {
    HarmonyNative.clearLastNotificationResponse()
  }
}

export function clearLastNotificationResponseIfMatches(identifier: string): boolean | null {
  if (
    !hasHarmonyNativeModule() ||
    typeof HarmonyNative.clearLastNotificationResponseIfMatches !== 'function'
  ) {
    return null
  }
  return HarmonyNative.clearLastNotificationResponseIfMatches(identifier)
}

export function getLastNotificationResponse(): NotificationResponse | null {
  return hasHarmonyNativeModule() ? HarmonyNative.getLastNotificationResponse() : null
}

export function addNotificationResponseReceivedListener(
  listener: (response: NotificationResponse) => void
) {
  return addHarmonyNativeListener<NotificationResponse>('OrcaHarmonyNotificationResponse', listener)
}

export async function getPermissionsAsync() {
  return hasHarmonyNativeModule()
    ? HarmonyNative.getNotificationPermission()
    : { canAskAgain: true, granted: false, status: 'undetermined' }
}

export async function requestPermissionsAsync() {
  return hasHarmonyNativeModule()
    ? HarmonyNative.requestNotificationPermission()
    : { canAskAgain: false, granted: false, status: 'denied' }
}

export async function scheduleNotificationAsync(request: {
  content: { body?: string; data?: Record<string, unknown>; title?: string }
  trigger?: unknown
}): Promise<string> {
  return HarmonyNative.scheduleNotification(request.content)
}

export async function dismissNotificationAsync(identifier: string): Promise<void> {
  if (hasHarmonyNativeModule()) {
    await HarmonyNative.dismissNotification(identifier)
  }
}

export async function setNotificationChannelAsync(_id: string, _channel: unknown): Promise<void> {}
