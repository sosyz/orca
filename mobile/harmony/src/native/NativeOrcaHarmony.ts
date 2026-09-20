import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes'

export interface Spec extends TurboModule {
  activateKeepAwake(tag: string): Promise<void>
  clearLastNotificationResponse(): void
  createImagePreview(uri: string): Promise<string>
  deactivateKeepAwake(tag: string): Promise<void>
  deleteFile(uri: string): void
  deleteSecureValue(key: string): Promise<void>
  dismissNotification(identifier: string): Promise<void>
  fileSize(uri: string): number
  getClipboardImage(): Promise<UnsafeObject | null>
  getClipboardString(): Promise<string>
  getLastNotificationResponse(): UnsafeObject | null
  getLatestUrlEvent(): UnsafeObject | null
  getNetworkState(): Promise<UnsafeObject>
  getNotificationPermission(): Promise<UnsafeObject>
  getSystemLocale(): string | null
  getSecureValue(key: string): Promise<string | null>
  hasClipboardImage(): Promise<boolean>
  hasClipboardString(): Promise<boolean>
  initializeAudio(): Promise<boolean>
  manipulateImage(uri: string, width: number, height: number): Promise<UnsafeObject>
  openFilePicker(kind: string, multiple: boolean): Promise<ReadonlyArray<UnsafeObject>>
  openApplicationSettings(): Promise<void>
  openExternalUrl(uri: string): Promise<void>
  randomBytes(length: number): ReadonlyArray<number>
  readFileBytes(uri: string, offset: number, length: number): ReadonlyArray<number>
  getMicrophonePermission(): Promise<boolean>
  requestMicrophonePermission(): Promise<boolean>
  requestNotificationPermission(): Promise<UnsafeObject>
  scanPairingCode(): Promise<string | null>
  scheduleNotification(content: UnsafeObject): Promise<string>
  setAudioRecording(enabled: boolean): boolean
  setClipboardString(value: string): Promise<void>
  setSecureValue(key: string, value: string): Promise<void>
  tearDownAudio(): void
  vibrate(kind: string): Promise<void>
  writeFile(uri: string, data: string, encoding: string): void
}

export default TurboModuleRegistry.get<Spec>('OrcaHarmony')
