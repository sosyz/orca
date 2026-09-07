import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAIRING_INPUT_MAX_CHARACTERS } from '../../../src/shared/mobile-pairing-protocol-limits'

const nativeRoot = resolve(import.meta.dirname, '../../harmony/entry/src/main/ets/native')

function readNativeSource(name: string): string {
  return readFileSync(join(nativeRoot, name), 'utf8')
}

describe('Harmony native service safety contract', () => {
  it('restricts native file writes/deletes and bounds picker file transfers', () => {
    const source = readNativeSource('HarmonyFileService.ets')

    expect(source).toContain('export const HARMONY_FILE_MAX_BYTES = 32 * 1024 * 1024')
    expect(source).toContain(
      "resolveUri(uri: string, operation: 'read' | 'write' | 'delete' = 'read')"
    )
    expect(source).toContain("if (uri.startsWith('content://'))")
    expect(source).toContain('path.startsWith(`${this.context.cacheDir}/`)')
    expect(source).toContain(
      "throw new Error('File writes and deletes are restricted to the app cache')"
    )
    expect(source).toContain('this.assertReadRange(offset, length)')
    expect(source).toContain('length > HARMONY_FILE_MAX_BYTES')
    expect(source).toContain('offset > HARMONY_FILE_MAX_BYTES - length')
    expect(source).toContain('fileIo.statSync(source.fd).size')
    expect(source).toContain("throw new Error('Unsupported cache URI')")
  })

  it('rejects oversized images before raster encoding and bounds PNG output', () => {
    const source = readNativeSource('HarmonyImageService.ets')

    expect(source).toContain('const HARMONY_IMAGE_MAX_PIXELS = 32 * 1024 * 1024')
    expect(source).toContain(
      'const HARMONY_IMAGE_MAX_BYTES = Math.floor((24 * 1024 * 1024 / 4) * 3)'
    )
    expect(source).toContain('this.assertImageSize(info.size.width, info.size.height)')
    expect(source).toContain('this.assertImageSize(original.size.width, original.size.height)')
    expect(source).toContain('this.assertImageSize(targetWidth, targetHeight)')
    expect(source).toContain('this.assertImageSize(rendered.size.width, rendered.size.height)')
    expect(source).toContain('packed.byteLength > HARMONY_IMAGE_MAX_BYTES')
    expect(source).toContain('width > Math.floor(HARMONY_IMAGE_MAX_PIXELS / height)')
    expect(source.indexOf('this.assertImageSize(info.size.width, info.size.height)')).toBeLessThan(
      source.indexOf('const packed = await this.packPng(pixelMap)')
    )
    expect(
      source.indexOf('this.assertImageSize(original.size.width, original.size.height)')
    ).toBeLessThan(source.indexOf('pixelMap = await source.createPixelMap(options)'))
  })

  it('copies picker URIs into cache and reads them through closed file descriptors', () => {
    const source = readNativeSource('HarmonyFileService.ets')

    expect(source).toContain("uri.startsWith('file:///')")
    expect(source).toContain('const file = fileIo.openSync(')
    expect(source).toContain('fileIo.readSync(file.fd, data, {')
    expect(source).toContain('await fileIo.copyFile(source.fd, path)')
    expect(source).toContain('this.assertByteLength(fileIo.statSync(path).size)')
    expect(source).toContain('return this.describe(this.fileUri(path))')
    expect(source).toContain('fileIo.closeSync(source)')
    expect(source).toContain('fileIo.closeSync(file)')
    expect(source.indexOf('const name = this.safePickedFileName(uri)')).toBeLessThan(
      source.indexOf('const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY)')
    )
    expect(source).toContain('try {\n      return decodeURIComponent(encoded)')
    expect(source).not.toContain('createRandomAccessFileSync')
  })

  it('marks cached picker files for deletion after JavaScript reads them', () => {
    const harmonyRoot = resolve(import.meta.dirname, '../../harmony')
    const documentPicker = readFileSync(
      join(harmonyRoot, 'src/compat/expo-document-picker.ts'),
      'utf8'
    )
    const imagePicker = readFileSync(join(harmonyRoot, 'src/compat/expo-image-picker.ts'), 'utf8')

    expect(documentPicker).toContain('isTemporary: true')
    expect(imagePicker).toContain('isTemporary: true')
  })

  it('lets picker failures reach the caller instead of treating every failure as cancellation', () => {
    const source = readNativeSource('HarmonyFileService.ets')
    const picker = source.slice(source.indexOf('async pick('), source.indexOf('cachePath('))

    expect(picker).toContain('picked.forEach((file) => this.delete(file.uri))')
    expect(picker).toContain('throw copyError as Error')
    expect(picker).not.toContain('return []')
  })

  it('only reports internet reachability after Harmony validates the network', () => {
    const source = readNativeSource('HarmonyNetworkService.ets')

    expect(source).toContain('connection.NetCap.NET_CAPABILITY_VALIDATED')
    expect(source).not.toContain('connection.NetCap.NET_CAPABILITY_INTERNET')
    expect(source).toContain("this.netConnection.on('netLost', () => {")
    expect(source).toContain('this.publishObserved(this.disconnected())')
    expect(source).toContain('this.publishCurrent(false)')
    expect(source).toContain('private publicationGeneration = 0')
    expect(source).toContain('generation === this.publicationGeneration')
    expect(source).toContain('private lastPublished: HarmonyNetworkState | null = null')
    expect(source).toContain('private sameState(')
    expect(source).toContain('if (this.destroyed)')
    expect(source).toContain('this.destroyed = true')
    expect(source).toContain('private readonly networkCallback')
    expect(source).toContain('register(this.networkCallback)')
    expect(source).toContain('unregister(this.networkCallback)')
    expect(source).toContain('try {\n      this.netConnection.unregister(')
    expect(source).toContain('private readonly networkCallback = (error: BusinessError)')
    expect(source).toContain('this.publishObserved(this.unknown())')
    expect(source).toContain("type: 'UNKNOWN'")
  })

  it('releases microphone and screen-on state when the Ability enters background', () => {
    const lifecycle = readNativeSource('HarmonyAppLifecycle.ets')
    const module = readNativeSource('OrcaHarmonyTurboModule.ets')
    const keepAwake = readNativeSource('HarmonyKeepAwakeService.ets')
    const ability = readFileSync(resolve(nativeRoot, '../entryability/EntryAbility.ets'), 'utf8')

    expect(ability).toContain('override onForeground(): void')
    expect(ability).toContain('super.onForeground()')
    expect(ability).toContain('HarmonyAppLifecycle.enterForeground()')
    expect(ability).toContain('override onBackground(): void')
    expect(ability).toContain('super.onBackground()')
    expect(ability).toContain('HarmonyAppLifecycle.enterBackground()')
    expect(lifecycle).toContain('listener.onHarmonyBackground()')
    expect(lifecycle).toContain('listener.onHarmonyForeground()')
    expect(module).toContain('this.audio.tearDown()')
    expect(module).toContain('this.keepAwake.setForeground(false)')
    expect(module).toContain('HarmonyAppLifecycle.detach(this.lifecycleListenerToken)')
    expect(keepAwake).toContain('this.foreground && this.owners.size > 0')
  })

  it('does not let an older notification module detach a newer listener', () => {
    const state = readNativeSource('HarmonyNotificationState.ets')
    const module = readNativeSource('OrcaHarmonyTurboModule.ets')

    expect(state).toContain(
      'static attach(listener: (response: HarmonyNotificationResponse) => void): number'
    )
    expect(state).toContain('static detach(token: number): void')
    expect(state).toContain('if (token !== HarmonyNotificationState.listenerToken)')
    expect(module).toContain('private readonly notificationListenerToken: number')
    expect(module).toContain('HarmonyNotificationState.detach(this.notificationListenerToken)')
  })

  it('accepts an AES-GCM payload containing only the authentication tag', () => {
    const source = readNativeSource('SecureValueStore.ets')

    expect(source).toContain('encrypted.length < TAG_BYTES')
    expect(source).toContain('HUKS_AUTH_STORAGE_LEVEL_ECE')
    expect(source).toContain('HUKS_TAG_AUTH_STORAGE_LEVEL')
    expect(source).toContain("const LEGACY_KEY_ALIAS = 'orca.mobile.harmony.secure-values.v2'")
    expect(source).toContain('await this.requireKey()')
    expect(source).not.toContain('await this.set(key, value)')
    expect(source).toContain('await this.migrateLegacyValue(store, key, encoded, value)')
    expect(source).toContain('private operationTail: Promise<void> = Promise.resolve()')
    expect(source).toContain('private enqueueOperation<T>(')
    expect(source).toContain('private async hasStoredV3Envelope(')
    expect(source).toContain('value.startsWith(`${ENVELOPE_VERSION}.`)')
    expect(source).toContain(
      "throw new Error('HUKS key is unavailable while v3 secure values exist')"
    )
    expect(source).toContain('private async restoreStoredValue(')
    expect(source).toContain('private async finishHuksSession(')
    expect(source).toContain('huks.abortSession(handle, { properties: options.properties })')
    expect(source).toContain('if (!completed)')
    expect(source).toContain("type EnvelopeVersion = 'v2' | 'v3'")
    expect(source).toContain('private keyPresenceDiagnosticLogged = false')
    expect(source).toContain('this.keyPresenceDiagnosticLogged = true')
    expect(source).toContain('read-${envelopeVersion}-decrypt-finish')
    expect(source).toContain('huks key-presence alias=%{public}s storage=%{public}s')
    expect(source).toContain('return Uint8Array.from(encoded.values())')
    expect(source).toContain("return buffer.from(value).toString('utf-8')")
    expect(source).not.toContain('new Uint8Array(encoded.buffer')
    expect(source).not.toContain('new Uint8Array(value.buffer')
    expect(source).toContain('huks.hasKeyItem(KEY_ALIAS, options)')
    expect(source).toContain('read-key-missing')
    expect(source).toContain('write-key-generate')
    expect(source.indexOf('private async requireKey()')).toBeLessThan(
      source.indexOf('private async decrypt(')
    )
    expect(source).not.toContain('huks.isKeyItemExist(KEY_ALIAS, options)')
    expect(source).not.toContain('encrypted.length <= TAG_BYTES')
  })

  it('rolls back a newly added keep-awake owner when activation fails', () => {
    const source = readNativeSource('HarmonyKeepAwakeService.ets')

    expect(source).toContain('const alreadyActive = this.owners.has(tag)')
    expect(source).toContain('if (!alreadyActive)')
    expect(source).toContain('this.owners.delete(tag)')
    expect(source).toContain('this.applyTail.then(() => this.apply(), () => this.apply())')
    expect(source).toContain('this.applyTail = pending.catch(() => undefined)')
    expect(source).toContain('throw activationError')
  })

  it('best-effort closes image resources even when source creation or release fails', () => {
    const source = readNativeSource('HarmonyImageService.ets')
    const manipulate = source.slice(
      source.indexOf('async manipulate('),
      source.indexOf('private async packPng(')
    )
    const releaseResources = source.slice(
      source.indexOf('private async releaseImageResources('),
      source.indexOf('private async packPng(')
    )

    expect(manipulate.indexOf('try {')).toBeLessThan(
      manipulate.indexOf('source = image.createImageSource(file.fd)')
    )
    expect(manipulate).toContain('this.releaseImageResources(pixelMap, source, file)')
    expect(manipulate).not.toContain('this.releaseImageResources(pixelMap, source, file).catch')
    expect(releaseResources).toContain('await pixelMap.release()')
    expect(releaseResources).toContain('await source.release()')
    expect(releaseResources.indexOf('await pixelMap.release()')).toBeLessThan(
      releaseResources.indexOf('await source.release()')
    )
    expect(releaseResources.indexOf('await source.release()')).toBeLessThan(
      releaseResources.indexOf('fileIo.closeSync(file)')
    )
    expect(releaseResources).not.toContain('releaseError')
  })

  it('packs images with the API 12-compatible ImagePacker method', () => {
    const source = readNativeSource('HarmonyImageService.ets')

    expect(source).toContain('packer.packing(pixelMap, options)')
    expect(source).not.toContain('packer.packToData(')
  })

  it('uses a sequence to avoid concurrent manipulated-image cache collisions', () => {
    const source = readNativeSource('HarmonyImageService.ets')

    expect(source).toContain('private manipulatedImageSequence = 0')
    expect(source).toContain('${this.manipulatedImageSequence++}.png')
  })

  it('suppresses only unsupported vibrator failures and catches keep-awake teardown', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const vibrate = source.slice(source.indexOf('async vibrate('), source.indexOf('addListener('))

    expect(source).toContain('this.keepAwake.clear().catch(')
    expect(vibrate).toContain('code !== 801 && code !== 14600101')
    expect(vibrate).toContain('throw vibrationError')
  })

  it('bounds native random bytes independently of the JavaScript adapter', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const randomBytes = source.slice(
      source.indexOf('randomBytes('),
      source.indexOf('setSecureValue(')
    )

    expect(randomBytes).toContain('Number.isFinite(length)')
    expect(randomBytes).toContain('Math.floor(length) !== length')
    expect(randomBytes).toContain('length < 0')
    expect(source).toContain('const MAX_RANDOM_BYTES = 1024')
    expect(randomBytes).toContain('length > MAX_RANDOM_BYTES')
    expect(randomBytes).toContain(
      'Random byte length must be an integer from 0 to ${MAX_RANDOM_BYTES}'
    )
  })

  it('accepts only the supported Orca pairing deep-link authority', () => {
    const source = readNativeSource('HarmonyLinkingState.ets')

    expect(PAIRING_INPUT_MAX_CHARACTERS).toBe(129 * 1024)
    expect(source).toContain('const PAIRING_INPUT_MAX_CHARACTERS = 129 * 1024')
    expect(source).toContain('value.length > PAIRING_INPUT_MAX_CHARACTERS')
    expect(source).toContain('const ORCA_LINK_PATTERN = /^orca:\\/\\/([^\\/?#]*)([^?#]*)?/i')
    expect(source).toContain(
      "return host === 'pair' && (pathname.length === 0 || pathname === '/')"
    )
    expect(source).toContain('isSupportedOrcaLink(value.trim())')
    expect(source).toContain('hasAsciiControlCharacter(value)')
  })

  it('keeps native external URL validation aligned with the http/https JS allowlist', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const linking = readFileSync(
      join(resolve(import.meta.dirname, '../../harmony/src/compat'), 'expo-linking.ts'),
      'utf8'
    )
    const openExternalUrl = source.slice(
      source.indexOf('async openExternalUrl('),
      source.indexOf('async openApplicationSettings(')
    )

    expect(source).toContain(
      'const SAFE_EXTERNAL_URL_PATTERN = /^(https?):\\/\\/([^\\/?#\\s]+)(?:[\\/?#].*)?$/i'
    )
    expect(source).toContain("authority.indexOf('@') !== -1")
    expect(source).toContain("authority.indexOf('%') !== -1")
    expect(source).toContain("authority.indexOf('\\\\') !== -1")
    expect(source).toContain('authority.length === 0')
    expect(source).toContain("authority.startsWith('[')")
    expect(source).toContain("host.indexOf(':') === -1")
    expect(source).toContain('port.length === 0')
    expect(source).toContain('Number(port) <= 65535')
    expect(source).toContain("value.indexOf('\\\\') !== -1")
    expect(openExternalUrl).toContain('isSafeExternalUrl(value)')
    expect(linking).toContain(
      'const SAFE_EXTERNAL_URL_PATTERN = /^(https?):\\/\\/([^/?#\\s]+)(?:[/?#].*)?$/i'
    )
    expect(linking).toContain("trimmed.includes('\\\\')")
    expect(linking).toContain("authorityMatch[2].includes('@')")
    expect(linking).toContain("const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])")
    expect(linking).not.toContain("'mailto:'")
  })

  it('checks clipboard availability without requesting restricted read permission', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const passiveChecks = source.slice(
      source.indexOf('async hasClipboardString('),
      source.indexOf('async getClipboardImage(')
    )

    expect(passiveChecks).toContain('systemPasteboard.hasData()')
    expect(passiveChecks).toContain('systemPasteboard.hasDataType(pasteboard.MIMETYPE_TEXT_PLAIN)')
    expect(passiveChecks).toContain('systemPasteboard.hasDataType(pasteboard.MIMETYPE_PIXELMAP)')
    expect(passiveChecks).toContain('this.permissions.isGranted(PASTEBOARD_PERMISSION)')
    expect(passiveChecks).toContain('return false')
    expect(passiveChecks).not.toContain('this.permissions.request(PASTEBOARD_PERMISSION)')
  })

  it('keeps microphone permission status queries separate from explicit requests', () => {
    const harmonyRoot = resolve(import.meta.dirname, '../../harmony')
    const spec = readFileSync(join(harmonyRoot, 'src/native/NativeOrcaHarmony.ts'), 'utf8')
    const compat = readFileSync(join(harmonyRoot, 'src/compat/expo-two-way-audio.ts'), 'utf8')
    const permissionService = readNativeSource('HarmonyPermissionService.ets')
    const audio = readNativeSource('HarmonyAudioService.ets')
    const module = readNativeSource('OrcaHarmonyTurboModule.ets')

    expect(spec).toContain('getMicrophonePermission(): Promise<boolean>')
    expect(compat).toContain('HarmonyNative.getMicrophonePermission()')
    expect(compat).not.toContain('return requestMicrophonePermissionsAsync()')
    expect(audio).toContain('getPermission(): Promise<boolean>')
    expect(module).toContain('getMicrophonePermission(): Promise<boolean>')
    expect(permissionService).not.toContain('requestPermissionOnSetting(')
  })

  it('surfaces denied explicit clipboard reads instead of reporting empty data', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const explicitReads = source.slice(
      source.indexOf('async getClipboardString('),
      source.indexOf('async scanPairingCode(')
    )

    expect(explicitReads.match(/throw new Error\(PASTEBOARD_PERMISSION_DENIED\)/g)).toHaveLength(2)
    expect(explicitReads).not.toMatch(
      /permissions\.request\(PASTEBOARD_PERMISSION\)\)\) \{\s+return (?:''|null)/
    )
    expect(explicitReads).toContain('systemPasteboard.hasDataType(pasteboard.MIMETYPE_TEXT_PLAIN)')
  })

  it('treats only the documented Scan Kit cancellation code as dismissal', () => {
    const source = readNativeSource('OrcaHarmonyTurboModule.ets')
    const scanner = source.slice(
      source.indexOf('async scanPairingCode('),
      source.indexOf('getNetworkState(')
    )

    expect(source).toContain('const SCAN_CANCELLED = 1000500002')
    expect(scanner).toContain("canIUse('SystemCapability.Multimedia.Scan.ScanBarcode')")
    expect(scanner).toContain('Scan Kit is unavailable on this device')
    expect(scanner).toContain('scanError.code === SCAN_CANCELLED')
    expect(scanner).toContain('throw new Error(`Scan Kit failed')
  })

  it('does not open permission settings from the generic request path', () => {
    const source = readNativeSource('HarmonyPermissionService.ets')

    expect(source).toContain('requestPermissionsFromUser(')
    expect(source).not.toContain('requestPermissionOnSetting(')
  })

  it('preserves undetermined notification state until the system prompt is attempted', () => {
    const source = readNativeSource('HarmonyNotificationService.ets')

    expect(source).toContain(
      'private permissionRequest: Promise<HarmonyNotificationPermission> | null'
    )
    expect(source).toContain('const request = this.requestPermissionOnce()')
    expect(source).toContain('if (this.permissionRequest === request)')
    expect(source).toContain("promptAttempted ? 'denied' : 'undetermined'")
    expect(source).toContain('permissionError.code === PERMISSION_REFUSED_CODE')
    expect(source).toContain('PERMISSION_REFUSED_CODE = 1600004')
    expect(source).toContain('SlotType.SERVICE_INFORMATION')
    expect(source).toContain('await this.permissionPreferences.flush()')
  })

  it('bounds audio startup and interrupts it outside the serialized lifecycle queue', () => {
    const source = readNativeSource('HarmonyAudioService.ets')

    expect(source).toContain('private lifecycleTail: Promise<void> = Promise.resolve()')
    expect(source).toContain('this.lifecycleTail.then(operation, operation)')
    expect(source).toContain('const AUDIO_START_TIMEOUT_MS = 3000')
    expect(source).toContain('await Promise.race([startResult, cancellation, timeout])')
    expect(source).toContain('clearTimeout(timeoutId)')
    expect(source).toContain('outcome === AudioStartOutcome.CANCELLED ||')
    expect(source).toContain('outcome === AudioStartOutcome.TIMED_OUT')
    expect(source).toContain('.then(() => this.releaseAfterAbandonedStart(capturer))')
    expect(source).toContain('private async releaseAfterAbandonedStart(')
    expect(source).toContain('await previousRelease')
    expect(source).toContain('await this.releaseCapturer(capturer)')
    expect(source).toContain('if (!enabled && this.interruptPendingStart())')
    expect(source).toContain('this.interruptPendingStart();\n    const capturer = this.capturer')
    expect(source).toContain('void this.releaseCapturer(capturer, true)')
    expect(source).not.toContain(
      'void this.enqueue(() => this.releaseCapturer(capturer)).catch(() => undefined)'
    )
    expect(source).toContain('this.generation += 1')
    expect(source).toContain('generation !== this.generation')
    expect(source).toContain('capturer !== this.capturer || !this.desiredRecording')
    expect(source).toContain('state === audio.AudioState.STATE_RUNNING')
    expect(source).toContain('state === audio.AudioState.STATE_PAUSED')
    expect(source).toContain('capturer.state === audio.AudioState.STATE_RELEASED')
    expect(source).toContain('await capturer.release()')
    expect(source).toContain('throw error as Error')
    expect(source).not.toContain('capturer.stop().catch(() => undefined).finally(')
  })

  it('rejects the mic-less emulator before creating an uncancellable API 12 capturer', () => {
    const source = readNativeSource('HarmonyAudioService.ets')
    const initialize = source.slice(
      source.indexOf('async initialize('),
      source.indexOf('private async createCapturer(')
    )

    expect(source).toContain("import { deviceInfo } from '@kit.BasicServicesKit'")
    expect(initialize).toContain("deviceInfo.productModel === 'emulator'")
    expect(initialize.indexOf("deviceInfo.productModel === 'emulator'")).toBeLessThan(
      initialize.indexOf('this.enqueue(')
    )
    expect(source).not.toContain('isRecordingAvailable')
  })

  it('deduplicates concurrent audio release attempts', () => {
    const source = readNativeSource('HarmonyAudioService.ets')

    expect(source).toContain(
      'private readonly releasePromises = new Map<audio.AudioCapturer, Promise<void>>()'
    )
    expect(source).toContain('const existing = this.releasePromises.get(capturer)')
    expect(source).toContain('if (existing) {\n      return existing;\n    }')
    expect(source).toContain('this.releasePromises.set(capturer, release)')
    expect(source).toContain('.finally(() => {')
    expect(source).toContain('private async releaseCapturerOnce(')
  })
})
