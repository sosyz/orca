import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type ImageSize = {
  height: number
  width: number
}

type ImageService = {
  clipboardImage(): Promise<{ data: string; size: ImageSize } | null>
  createImagePreview(uri: string): Promise<string>
  manipulate(
    uri: string,
    width: number,
    height: number
  ): Promise<{ base64: string; height: number; uri: string; width: number }>
}

type NativeReleaseFailure = {
  error: Error
  mode: 'reject' | 'throw'
}

function nativeReleaseMock(failure: NativeReleaseFailure | undefined) {
  return vi.fn(() => {
    if (!failure) {
      return Promise.resolve()
    }
    if (failure.mode === 'throw') {
      throw failure.error
    }
    return Promise.reject(failure.error)
  })
}

function setupImageService(options?: {
  clipboardHasData?: boolean
  clipboardMimeTypes?: string[]
  closeError?: Error
  createPixelMapError?: Error
  packerReleaseFailure?: NativeReleaseFailure
  pixelMapReleaseFailure?: NativeReleaseFailure
  sourceReleaseFailure?: NativeReleaseFailure
}) {
  const packed = new Uint8Array([1, 2, 3, 4]).buffer
  const pixelMap = {
    getImageInfo: vi.fn(async () => ({ size: { height: 3, width: 2 } })),
    release: nativeReleaseMock(options?.pixelMapReleaseFailure)
  }
  const source = {
    getImageInfo: vi.fn(async () => ({ size: { height: 4, width: 4 } })),
    createPixelMap: vi.fn(async () => {
      if (options?.createPixelMapError) {
        throw options.createPixelMapError
      }
      return pixelMap
    }),
    release: nativeReleaseMock(options?.sourceReleaseFailure)
  }
  const packer = {
    packing: vi.fn(async () => packed),
    release: nativeReleaseMock(options?.packerReleaseFailure)
  }
  const file = { fd: 42 }
  const fileIo = {
    OpenMode: { READ_ONLY: 1 },
    closeSync: vi.fn(() => {
      if (options?.closeError) {
        throw options.closeError
      }
    }),
    openSync: vi.fn(() => file)
  }
  const files = {
    cachePath: vi.fn((name: string) => `/cache/${name}`),
    fileUri: vi.fn((path: string) => `file://${path}`),
    resolveUri: vi.fn((uri: string) => uri),
    writeBytes: vi.fn()
  }
  const clipboardRecords = (options?.clipboardMimeTypes ?? ['pixelMap']).map((mimeType) => ({
    mimeType,
    pixelMap: mimeType === 'pixelMap' ? pixelMap : undefined
  }))
  const clipboardData = {
    getPrimaryMimeType: vi.fn(() => clipboardRecords[0]?.mimeType ?? ''),
    getPrimaryPixelMap: vi.fn(() => clipboardRecords[0]?.pixelMap),
    getRecordCount: vi.fn(() => clipboardRecords.length),
    getRecord: vi.fn((index: number) => clipboardRecords[index])
  }
  const pasteboard = {
    MIMETYPE_PIXELMAP: 'pixelMap',
    getSystemPasteboard: vi.fn(() => ({
      getData: vi.fn(async () => clipboardData),
      hasData: vi.fn(async () => options?.clipboardHasData !== false)
    }))
  }
  const { HarmonyImageService } = loadHarmonyNativeService<{
    HarmonyImageService: new (files: typeof files) => ImageService
  }>('HarmonyImageService.ets', {
    '@kit.ArkTS': {
      util: {
        Base64Helper: class {
          encodeToStringSync(data: Uint8Array) {
            return Buffer.from(data).toString('base64')
          }
        }
      }
    },
    '@kit.BasicServicesKit': { pasteboard },
    '@kit.CoreFileKit': { fileIo },
    '@kit.ImageKit': {
      image: {
        createImagePacker: () => packer,
        createImageSource: () => source
      }
    },
    './HarmonyFileService': {}
  })

  return {
    clipboardData,
    fileIo,
    files,
    packer,
    pixelMap,
    service: new HarmonyImageService(files),
    source
  }
}

describe('Harmony image service', () => {
  it('reads and releases a primary image record with accompanying text', async () => {
    const { pixelMap, service } = setupImageService({
      clipboardMimeTypes: ['pixelMap', 'text/plain']
    })

    await expect(service.clipboardImage()).resolves.toEqual({
      data: 'data:image/png;base64,AQIDBA==',
      size: { height: 3, width: 2 }
    })
    expect(pixelMap.release).toHaveBeenCalledOnce()
  })

  it('reads and releases an image after text and HTML records', async () => {
    const { clipboardData, pixelMap, service } = setupImageService({
      clipboardMimeTypes: ['text/plain', 'text/html', 'pixelMap']
    })

    await expect(service.clipboardImage()).resolves.toEqual({
      data: 'data:image/png;base64,AQIDBA==',
      size: { height: 3, width: 2 }
    })
    expect(clipboardData.getRecord).toHaveBeenCalledWith(2)
    expect(pixelMap.release).toHaveBeenCalledOnce()
  })

  it.each([
    { label: 'plain text only', mimeTypes: ['text/plain'], hasData: true },
    { label: 'no image records', mimeTypes: [], hasData: true },
    { label: 'empty clipboard', mimeTypes: [], hasData: false }
  ])(
    'returns no image for $label without acquiring an image resource',
    async ({ mimeTypes, hasData }) => {
      const { clipboardData, pixelMap, service } = setupImageService({
        clipboardHasData: hasData,
        clipboardMimeTypes: mimeTypes
      })

      await expect(service.clipboardImage()).resolves.toBeNull()
      expect(pixelMap.release).not.toHaveBeenCalled()
      if (!hasData) {
        expect(clipboardData.getRecord).not.toHaveBeenCalled()
      }
    }
  )

  it('returns a manipulated image when native cleanup releases reject asynchronously', async () => {
    const { fileIo, files, packer, pixelMap, service, source } = setupImageService({
      packerReleaseFailure: { error: new Error('packer release failed'), mode: 'reject' },
      pixelMapReleaseFailure: { error: new Error('pixel map release failed'), mode: 'reject' },
      sourceReleaseFailure: { error: new Error('source release failed'), mode: 'reject' }
    })

    await expect(service.manipulate('file:///cache/source.png', 2, 3)).resolves.toMatchObject({
      base64: 'AQIDBA==',
      height: 3,
      width: 2
    })

    expect(files.writeBytes).toHaveBeenCalledOnce()
    expect(packer.release).toHaveBeenCalledOnce()
    expect(pixelMap.release).toHaveBeenCalledOnce()
    expect(source.release).toHaveBeenCalledOnce()
    expect(fileIo.closeSync).toHaveBeenCalledWith({ fd: 42 })
  })

  it('fits a preview without upscaling, avoids cache writes, and releases native resources', async () => {
    const { fileIo, files, packer, pixelMap, service, source } = setupImageService()
    source.getImageInfo.mockResolvedValue({ size: { width: 4000, height: 1000 } })
    pixelMap.getImageInfo.mockResolvedValue({ size: { width: 400, height: 100 } })

    await expect(service.createImagePreview('file:///cache/picked.heif')).resolves.toBe('AQIDBA==')
    expect(source.createPixelMap).toHaveBeenCalledWith({ desiredSize: { width: 400, height: 100 } })
    expect(files.writeBytes).not.toHaveBeenCalled()
    expect(packer.release).toHaveBeenCalledOnce()
    expect(pixelMap.release).toHaveBeenCalledOnce()
    expect(source.release).toHaveBeenCalledOnce()
    expect(fileIo.closeSync).toHaveBeenCalledWith({ fd: 42 })
  })

  it.each([
    { original: { width: 1000, height: 4000 }, target: { width: 75, height: 300 } },
    { original: { width: 200, height: 100 }, target: { width: 200, height: 100 } },
    { original: { width: 1, height: 1000 }, target: { width: 1, height: 300 } }
  ])('preserves aspect ratio and never upscales $original', async ({ original, target }) => {
    const { service, source } = setupImageService()
    source.getImageInfo.mockResolvedValue({ size: original })

    await service.createImagePreview('file:///cache/picked.png')
    expect(source.createPixelMap).toHaveBeenCalledWith({ desiredSize: target })
  })

  it('rejects oversized or ignored preview decoding while releasing every resource', async () => {
    const oversized = setupImageService()
    oversized.packer.packing.mockResolvedValue(new Uint8Array(768 * 1024 + 1).buffer)
    await expect(oversized.service.createImagePreview('file:///cache/picked.png')).rejects.toThrow(
      'Image data exceeds the Harmony limit'
    )
    expect(oversized.files.writeBytes).not.toHaveBeenCalled()
    expect(oversized.packer.release).toHaveBeenCalledOnce()
    expect(oversized.pixelMap.release).toHaveBeenCalledOnce()
    expect(oversized.source.release).toHaveBeenCalledOnce()
    expect(oversized.fileIo.closeSync).toHaveBeenCalledOnce()

    const ignored = setupImageService()
    ignored.pixelMap.getImageInfo.mockResolvedValue({ size: { width: 401, height: 300 } })
    await expect(ignored.service.createImagePreview('file:///cache/picked.png')).rejects.toThrow(
      'Image preview exceeds the Harmony limit'
    )
    expect(ignored.packer.packing).not.toHaveBeenCalled()
    expect(ignored.pixelMap.release).toHaveBeenCalledOnce()
    expect(ignored.source.release).toHaveBeenCalledOnce()
    expect(ignored.fileIo.closeSync).toHaveBeenCalledOnce()
  })

  it('preserves decode failure and closes the picked file before the picker reads it', async () => {
    const { fileIo, files, service, source } = setupImageService({
      createPixelMapError: new Error('decode failed')
    })
    await expect(service.createImagePreview('file:///cache/picked.heif')).rejects.toThrow(
      'decode failed'
    )
    expect(source.release).toHaveBeenCalledOnce()
    expect(fileIo.closeSync).toHaveBeenCalledOnce()
    expect(files.writeBytes).not.toHaveBeenCalled()
  })

  it('returns a manipulated image and keeps trying cleanup when releases throw synchronously', async () => {
    const { fileIo, packer, pixelMap, service, source } = setupImageService({
      closeError: new Error('close failed'),
      packerReleaseFailure: { error: new Error('packer release failed'), mode: 'throw' },
      pixelMapReleaseFailure: { error: new Error('pixel map release failed'), mode: 'throw' },
      sourceReleaseFailure: { error: new Error('source release failed'), mode: 'throw' }
    })

    await expect(service.manipulate('file:///cache/source.png', 2, 3)).resolves.toMatchObject({
      base64: 'AQIDBA==',
      height: 3,
      width: 2
    })

    expect(packer.release).toHaveBeenCalledOnce()
    expect(pixelMap.release).toHaveBeenCalledOnce()
    expect(source.release).toHaveBeenCalledOnce()
    expect(fileIo.closeSync).toHaveBeenCalledWith({ fd: 42 })
  })

  it('preserves image operation failures when cleanup also fails', async () => {
    const { fileIo, service, source } = setupImageService({
      closeError: new Error('close failed'),
      createPixelMapError: new Error('decode failed'),
      sourceReleaseFailure: { error: new Error('source release failed'), mode: 'throw' }
    })

    await expect(service.manipulate('file:///cache/source.png', 2, 3)).rejects.toThrow(
      'decode failed'
    )

    expect(source.release).toHaveBeenCalledOnce()
    expect(fileIo.closeSync).toHaveBeenCalledWith({ fd: 42 })
  })

  it('returns a clipboard image when pixel map release rejects after packing', async () => {
    const { pixelMap, service } = setupImageService({
      pixelMapReleaseFailure: { error: new Error('release failed'), mode: 'reject' }
    })

    await expect(service.clipboardImage()).resolves.toEqual({
      data: 'data:image/png;base64,AQIDBA==',
      size: { height: 3, width: 2 }
    })

    expect(pixelMap.release).toHaveBeenCalledOnce()
  })

  it('returns a clipboard image when pixel map release throws synchronously after packing', async () => {
    const { pixelMap, service } = setupImageService({
      pixelMapReleaseFailure: { error: new Error('release failed'), mode: 'throw' }
    })

    await expect(service.clipboardImage()).resolves.toEqual({
      data: 'data:image/png;base64,AQIDBA==',
      size: { height: 3, width: 2 }
    })

    expect(pixelMap.release).toHaveBeenCalledOnce()
  })
})
