import { addHarmonyNativeListener, HarmonyNative } from '../native/harmony-native-module'

export interface MicrophoneDataEvent {
  data: Uint8Array
}

export interface AudioInterruptionEvent {
  data: string
}

type AudioEventMap = {
  onAudioInterruption: AudioInterruptionEvent
  onMicrophoneData: MicrophoneDataEvent
}

const permission = (granted: boolean) => ({
  canAskAgain: !granted,
  expires: 'never',
  granted,
  status: granted ? 'granted' : 'denied'
})

export async function initialize(): Promise<boolean> {
  return HarmonyNative.initializeAudio()
}

export async function requestMicrophonePermissionsAsync() {
  return permission(await HarmonyNative.requestMicrophonePermission())
}

export async function getMicrophonePermissionsAsync() {
  return permission(await HarmonyNative.getMicrophonePermission())
}

export function toggleRecording(enabled: boolean): boolean {
  return HarmonyNative.setAudioRecording(enabled)
}

export function tearDown(): void {
  HarmonyNative.tearDownAudio()
}

export function addExpoTwoWayAudioEventListener<K extends keyof AudioEventMap>(
  eventName: K,
  listener: (event: AudioEventMap[K]) => void
) {
  return addHarmonyNativeListener<AudioEventMap[K]>(eventName, listener)
}
