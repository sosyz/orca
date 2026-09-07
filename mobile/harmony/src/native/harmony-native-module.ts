import { DeviceEventEmitter, NativeModules } from 'react-native'
import NativeOrcaHarmony, { type Spec } from './NativeOrcaHarmony'

type Subscription = { remove(): void }

export type HarmonyNotificationResponse = {
  actionIdentifier: string
  notification: {
    request: {
      content: { data?: Record<string, unknown> }
      identifier: string
    }
  }
}

type HarmonyNativePayloadMethods = {
  getClipboardImage(): Promise<{ data: string; size: { height: number; width: number } } | null>
  getLastNotificationResponse(): HarmonyNotificationResponse | null
  getLatestUrlEvent(): { sequence: number; url: string } | null
  getNetworkState(): Promise<{ isConnected: boolean; isInternetReachable: boolean; type: string }>
  getNotificationPermission(): Promise<{ canAskAgain: boolean; granted: boolean; status: string }>
  manipulateImage(
    uri: string,
    width: number,
    height: number
  ): Promise<{
    base64: string
    height: number
    uri: string
    width: number
  }>
  openFilePicker(
    kind: 'document' | 'image',
    multiple: boolean
  ): Promise<Array<{ fileName?: string; fileSize?: number; mimeType?: string; uri: string }>>
  requestNotificationPermission(): Promise<{
    canAskAgain: boolean
    granted: boolean
    status: string
  }>
  scheduleNotification(content: {
    body?: string
    data?: Record<string, unknown>
    title?: string
  }): Promise<string>
}

export type HarmonyNativeModule = Omit<Spec, keyof HarmonyNativePayloadMethods> &
  HarmonyNativePayloadMethods

const moduleFromRegistry = NativeOrcaHarmony as HarmonyNativeModule | null
let moduleFromLegacyBridge: HarmonyNativeModule | null | undefined

function resolveHarmonyNativeModule(): HarmonyNativeModule | null {
  if (moduleFromRegistry) {
    return moduleFromRegistry
  }
  if (moduleFromLegacyBridge !== undefined) {
    return moduleFromLegacyBridge
  }
  try {
    moduleFromLegacyBridge = (NativeModules.OrcaHarmony as HarmonyNativeModule | undefined) ?? null
  } catch {
    moduleFromLegacyBridge = null
  }
  return moduleFromLegacyBridge
}

function requireHarmonyNativeModule(): HarmonyNativeModule {
  const nativeModule = resolveHarmonyNativeModule()
  if (!nativeModule) {
    throw new Error('OrcaHarmony native module is unavailable')
  }
  return nativeModule
}

// Why: some RNOH builds throw while reading an unknown NativeModules property;
// defer the legacy bridge lookup until an adapter actually needs it.
const lazyLegacyHarmonyNative = new Proxy({} as HarmonyNativeModule, {
  get(_target, property) {
    const nativeModule = requireHarmonyNativeModule()
    const value = Reflect.get(nativeModule, property, nativeModule) as unknown
    return typeof value === 'function' ? value.bind(nativeModule) : value
  }
})
export const HarmonyNative: HarmonyNativeModule = moduleFromRegistry ?? lazyLegacyHarmonyNative

export function addHarmonyNativeListener<T>(
  eventName: string,
  listener: (event: T) => void
): Subscription {
  return DeviceEventEmitter.addListener(eventName, listener)
}

export function hasHarmonyNativeModule(): boolean {
  return resolveHarmonyNativeModule() !== null
}
