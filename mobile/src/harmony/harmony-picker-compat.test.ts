import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  available: true,
  createImagePreview: vi.fn<(uri: string) => Promise<string>>(),
  openFilePicker: vi.fn<
    (
      _kind: string,
      _multiple: boolean
    ) => Promise<
      Array<{
        fileName?: string
        fileSize?: number
        mimeType?: string
        uri: string
      }>
    >
  >()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: {
    createImagePreview: native.createImagePreview,
    openFilePicker: native.openFilePicker
  },
  hasHarmonyNativeModule: () => native.available
}))

import { getDocumentAsync } from '../../harmony/src/compat/expo-document-picker'
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync
} from '../../harmony/src/compat/expo-image-picker'

describe('Harmony picker adapters', () => {
  beforeEach(() => {
    native.available = true
    native.createImagePreview.mockReset().mockResolvedValue('AQIDBA==')
    native.openFilePicker.mockReset().mockResolvedValue([])
  })

  it('reports a real user cancellation from an available picker', async () => {
    await expect(getDocumentAsync()).resolves.toMatchObject({ canceled: true, assets: [] })
    await expect(launchImageLibraryAsync()).resolves.toMatchObject({ canceled: true, assets: [] })
    expect(native.openFilePicker.mock.calls).toEqual([
      ['document', false],
      ['image', false]
    ])
  })

  it('rejects when the native picker is unavailable instead of claiming cancellation', async () => {
    native.available = false

    await expect(getDocumentAsync()).rejects.toThrow('Harmony document picker is unavailable')
    await expect(requestMediaLibraryPermissionsAsync()).rejects.toThrow(
      'Harmony image picker is unavailable'
    )
    await expect(launchImageLibraryAsync()).rejects.toThrow('Harmony image picker is unavailable')
    expect(native.openFilePicker).not.toHaveBeenCalled()
  })

  it('propagates native picker failures to the shared image flow', async () => {
    native.openFilePicker.mockRejectedValue(new Error('picker failed'))

    await expect(getDocumentAsync()).rejects.toThrow('picker failed')
    await expect(launchImageLibraryAsync()).rejects.toThrow('picker failed')
  })

  it('generates previews lazily for either temporary picker source', async () => {
    native.openFilePicker.mockResolvedValue([
      { uri: 'file:///cache/picked.heif', fileSize: 4, mimeType: 'image/heif' }
    ])
    const library = await launchImageLibraryAsync()
    const documents = await getDocumentAsync()
    expect(native.createImagePreview).not.toHaveBeenCalled()
    await expect(library.assets[0]?.getPreviewUri()).resolves.toBe('data:image/png;base64,AQIDBA==')
    await expect(documents.assets[0]?.getPreviewUri()).resolves.toBe(
      'data:image/png;base64,AQIDBA=='
    )
    expect(native.createImagePreview).toHaveBeenNthCalledWith(1, 'file:///cache/picked.heif')
    expect(native.createImagePreview).toHaveBeenNthCalledWith(2, 'file:///cache/picked.heif')
  })

  it('rejects an oversized native preview instead of retaining it', async () => {
    native.createImagePreview.mockResolvedValue('A'.repeat(1024 * 1024 + 1))
    native.openFilePicker.mockResolvedValue([{ uri: 'file:///cache/picked.png' }])
    const picked = await launchImageLibraryAsync()
    await expect(picked.assets[0]?.getPreviewUri()).rejects.toThrow(
      'Harmony image preview is unavailable'
    )
  })
})
