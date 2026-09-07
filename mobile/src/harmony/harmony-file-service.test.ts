import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type FileService = {
  write(uri: string, data: string, encoding: string): void
  writeBytes(uri: string, data: ArrayBuffer): void
  pick(kind: string, multiple: boolean): Promise<Array<{ uri: string }>>
}

function setup(uris: string[] = []) {
  let nextFd = 0
  const files = new Map<number, string>()
  const fileIo = {
    OpenMode: { READ_ONLY: 1, CREATE: 2, READ_WRITE: 4, TRUNC: 8 },
    openSync: vi.fn((path: string) => {
      files.set(++nextFd, path)
      return { fd: nextFd }
    }),
    closeSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 4 })),
    writeSync: vi.fn((_fd: number, data: ArrayBuffer) => data.byteLength),
    copyFile: vi.fn(async (_fd: number, _path: string) => undefined),
    unlinkSync: vi.fn()
  }
  const { HarmonyFileService } = loadHarmonyNativeService<{
    HarmonyFileService: new (context: object) => FileService
  }>('HarmonyFileService.ets', {
    '@kit.ArkTS': {
      buffer: Buffer,
      util: {
        Base64Helper: class {
          decodeSync(data: string) {
            return Buffer.from(data, 'base64')
          }
        }
      }
    },
    '@kit.CoreFileKit': { fileIo },
    '@kit.MediaLibraryKit': {
      photoAccessHelper: {
        PhotoSelectOptions: class {},
        PhotoViewMIMETypes: { IMAGE_TYPE: 'image/*' },
        PhotoViewPicker: class {
          async select() {
            return { photoUris: uris }
          }
        }
      }
    }
  })
  return { service: new HarmonyFileService({ cacheDir: '/cache' }), fileIo, files }
}

describe('Harmony file service', () => {
  it.each(['utf8', 'base64'])(
    'writes the exact %s payload without buffer-pool bytes',
    (encoding) => {
      const { service, fileIo } = setup()
      const payload = Buffer.from('图片 🐋\0 content')
      service.write(
        'file://orca-cache/test.png',
        payload.toString(encoding as BufferEncoding),
        encoding
      )
      expect(Buffer.from(fileIo.writeSync.mock.calls[0][1])).toEqual(payload)
      expect(fileIo.closeSync).toHaveBeenCalledOnce()
    }
  )

  it('passes packed image bytes directly to disk without copying', () => {
    const { service, fileIo } = setup()
    const packed = new Uint8Array([137, 80, 78, 71]).buffer
    service.writeBytes('file://orca-cache/test.png', packed)
    expect(fileIo.writeSync.mock.calls[0][1]).toBe(packed)
  })

  it('rejects oversized or non-cache writes before opening a file', () => {
    const { service, fileIo } = setup()
    expect(() => service.writeBytes('file:///outside/test', new ArrayBuffer(0))).toThrow()
    expect(() => service.writeBytes('file://orca-cache/../test', new ArrayBuffer(0))).toThrow()
    expect(() =>
      service.writeBytes('file://orca-cache/test', new ArrayBuffer(32 * 1024 * 1024 + 1))
    ).toThrow()
    expect(fileIo.openSync).not.toHaveBeenCalled()
  })

  it('closes the descriptor and deletes the partial file after an incomplete write', () => {
    const { service, fileIo } = setup()
    fileIo.writeSync.mockReturnValueOnce(1)
    expect(() => service.writeBytes('file://orca-cache/test', new ArrayBuffer(4))).toThrow(
      'Incomplete cache file write'
    )
    expect(fileIo.closeSync).toHaveBeenCalledOnce()
    expect(fileIo.unlinkSync).toHaveBeenCalledWith('/cache/test')
  })

  it('awaits each picker copy and keeps its descriptor open until completion', async () => {
    const { service, fileIo, files } = setup(['content://one.png', 'content://two.png'])
    let finishCopy: () => void = () => undefined
    fileIo.copyFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve
        })
    )
    const result = service.pick('image', true)
    await vi.waitFor(() => expect(fileIo.copyFile).toHaveBeenCalledOnce())
    expect(fileIo.closeSync).not.toHaveBeenCalled()
    finishCopy()
    const picked = await result
    expect(picked).toHaveLength(2)
    expect(fileIo.copyFile.mock.calls.map(([fd]) => files.get(fd))).toEqual([
      'content://one.png',
      'content://two.png'
    ])
    expect(fileIo.closeSync.mock.calls.map(([file]) => files.get(file.fd))).toEqual(
      expect.arrayContaining(['content://one.png', 'content://two.png'])
    )
  })

  it('cleans completed and partial cache files when a later copy fails', async () => {
    const { service, fileIo } = setup(['content://one.png', 'content://two.png'])
    fileIo.copyFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('copy failed'))
    await expect(service.pick('image', true)).rejects.toThrow('copy failed')
    const destinations = fileIo.copyFile.mock.calls.map(([, path]) => path)
    expect(fileIo.unlinkSync.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining(destinations)
    )
    expect(fileIo.closeSync).toHaveBeenCalledTimes(3)
  })

  it('deletes a picker copy when the cached result exceeds the native bridge limit', async () => {
    const { service, fileIo } = setup(['content://large.png'])
    fileIo.statSync.mockImplementation((target: number | string) => ({
      size: typeof target === 'string' ? 32 * 1024 * 1024 + 1 : 4
    }))

    await expect(service.pick('image', false)).rejects.toThrow(
      'File data exceeds the Harmony limit'
    )

    const destination = fileIo.copyFile.mock.calls[0][1]
    expect(fileIo.unlinkSync).toHaveBeenCalledWith(destination)
    expect(fileIo.closeSync).toHaveBeenCalledOnce()
  })
})
