import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type ClipboardRecord = { mimeType: string; plainText?: string }
type ClipboardMethods = {
  getClipboardString(): Promise<string>
  hasClipboardString(): Promise<boolean>
}

function setupClipboard(
  records: ClipboardRecord[],
  options?: { denied?: boolean; hasData?: boolean }
) {
  const getData = vi.fn(async () => ({
    getPrimaryText: () => records[0]?.plainText ?? '',
    getRecordCount: () => records.length,
    getRecord: (index: number) => records[index]
  }))
  const systemPasteboard = {
    getData,
    hasData: vi.fn(async () => options?.hasData ?? records.length > 0),
    hasDataType: vi.fn((mimeType: string) => records.some((record) => record.mimeType === mimeType))
  }
  const pasteboard = {
    MIMETYPE_TEXT_PLAIN: 'text/plain',
    MIMETYPE_PIXELMAP: 'pixelMap',
    getSystemPasteboard: vi.fn(() => systemPasteboard)
  }
  const { OrcaHarmonyTurboModule } = loadHarmonyNativeService<{
    OrcaHarmonyTurboModule: { prototype: ClipboardMethods }
  }>('OrcaHarmonyTurboModule.ets', {
    '@kit.BasicServicesKit': { pasteboard },
    '@kit.CryptoArchitectureKit': { cryptoFramework: {} },
    '@kit.LocalizationKit': { i18n: {} },
    '@kit.ScanKit': { scanBarcode: {}, scanCore: {} },
    '@kit.SensorServiceKit': { vibrator: {} },
    '@rnoh/react-native-openharmony/ts': { UITurboModule: class {} },
    './HarmonyAudioService': {},
    './HarmonyAppLifecycle': {},
    './HarmonyFileService': {},
    './HarmonyImageService': {},
    './HarmonyKeepAwakeService': {},
    './HarmonyLinkingState': {},
    './HarmonyNetworkService': {},
    './HarmonyNotificationService': {},
    './HarmonyNotificationState': {},
    './HarmonyPermissionService': {},
    './SecureValueStore': {}
  })
  const permissions = {
    request: vi.fn(async () => !options?.denied),
    isGranted: vi.fn(() => !options?.denied)
  }
  const service = Object.assign(Object.create(OrcaHarmonyTurboModule.prototype), {
    permissions
  }) as ClipboardMethods
  return { getData, pasteboard, permissions, service, systemPasteboard }
}

describe('Harmony native clipboard string getter', () => {
  it('returns a plain text record', async () => {
    const { service } = setupClipboard([{ mimeType: 'text/plain', plainText: 'hello' }])
    await expect(service.hasClipboardString()).resolves.toBe(true)
    await expect(service.getClipboardString()).resolves.toBe('hello')
  })

  it('returns the first plain text record after an image and leaves image records untouched', async () => {
    const image = { mimeType: 'pixelMap', release: vi.fn() }
    const { service, systemPasteboard } = setupClipboard([
      image,
      { mimeType: 'text/plain', plainText: 'copied command' },
      { mimeType: 'text/plain', plainText: 'later text' }
    ])
    await expect(service.hasClipboardString()).resolves.toBe(true)
    await expect(service.getClipboardString()).resolves.toBe('copied command')
    expect(image.release).not.toHaveBeenCalled()
    expect(systemPasteboard.hasDataType).toHaveBeenCalledWith('text/plain')
  })

  it('returns empty for an empty clipboard without reading data', async () => {
    const { getData, service } = setupClipboard([])
    await expect(service.getClipboardString()).resolves.toBe('')
    expect(getData).not.toHaveBeenCalled()
  })

  it('returns empty when records contain no plain text', async () => {
    const { getData, service } = setupClipboard([
      { mimeType: 'pixelMap' },
      { mimeType: 'text/html' }
    ])
    await expect(service.hasClipboardString()).resolves.toBe(false)
    await expect(service.getClipboardString()).resolves.toBe('')
    expect(getData).not.toHaveBeenCalled()
  })

  it('rejects permission denial before accessing the system pasteboard', async () => {
    const { pasteboard, permissions, service } = setupClipboard(
      [{ mimeType: 'text/plain', plainText: 'secret' }],
      { denied: true }
    )
    await expect(service.getClipboardString()).rejects.toThrow('Clipboard permission denied')
    expect(permissions.request).toHaveBeenCalledWith('ohos.permission.READ_PASTEBOARD')
    expect(pasteboard.getSystemPasteboard).not.toHaveBeenCalled()
  })
})
