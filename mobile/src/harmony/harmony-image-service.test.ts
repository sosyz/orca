import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type ImageSize = {
  height: number
  width: number
}

type ImageService = {
  clipboardImage(): Promise<{ data: string; size: ImageSize } | null>
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
  const pasteboard = {
    MIMETYPE_PIXELMAP: 'image/pixelmap',
    getSystemPasteboard: vi.fn(() => ({
      getData: vi.fn(async () => ({
        getPrimaryMimeType: () => 'image/pixelmap',
        getPrimaryPixelMap: () => pixelMap
      })),
      hasData: vi.fn(async () => true)
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
    fileIo,
    files,
    packer,
    pixelMap,
    service: new HarmonyImageService(files),
    source
  }
}

describe('Harmony image service', () => {
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
