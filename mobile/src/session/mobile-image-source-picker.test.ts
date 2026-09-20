import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn()
}))
vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn()
}))
vi.mock('expo-file-system', () => ({
  File: vi.fn()
}))

import {
  ImageLibraryPermissionError,
  pickMobileImage,
  pickMobileImages,
  type PickedMobileImage
} from './mobile-image-source-picker'
import { uploadMobileNativeChatImages } from './mobile-native-chat-image-attachment'

const granted = { granted: true } as Awaited<
  ReturnType<typeof import('expo-image-picker').requestMediaLibraryPermissionsAsync>
>
const denied = { granted: false } as typeof granted

async function collectImages(
  images: AsyncIterable<PickedMobileImage>
): Promise<PickedMobileImage[]> {
  const collected: PickedMobileImage[] = []
  for await (const image of images) {
    collected.push(image)
  }
  return collected
}

function fileFactory(
  bytes: Uint8Array,
  options?: { fileSize?: number; handleSize?: number | null; readError?: Error }
) {
  const close = vi.fn()
  const deleteFile = vi.fn()
  const chunks = [bytes]
  const readBytes = vi.fn(() => {
    if (options?.readError) {
      throw options.readError
    }
    return chunks.shift() ?? new Uint8Array()
  })
  const open = vi.fn(() => ({
    size: options?.handleSize ?? options?.fileSize ?? bytes.length,
    readBytes,
    close
  }))
  const createFile = vi.fn(() => ({
    size: options?.fileSize ?? bytes.length,
    delete: deleteFile,
    open
  }))
  return { close, createFile, deleteFile, open }
}

describe('pickMobileImage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads a photo URI without relying on React Native fetch', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    const file = fileFactory(bytes)
    const launchLibrary = vi.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///x.jpg', fileSize: bytes.length }]
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network request failed'))
    const result = await pickMobileImage('library', {
      requestLibraryPermission: vi.fn().mockResolvedValue(granted),
      launchLibrary,
      createFile: file.createFile
    })

    expect(result).toEqual({
      base64: Buffer.from(bytes).toString('base64'),
      uri: 'file:///x.jpg'
    })
    expect(launchLibrary).toHaveBeenCalledWith(expect.objectContaining({ base64: false }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(file.close).toHaveBeenCalledTimes(1)
  })

  it('returns every selected library photo in order', async () => {
    const bytesByUri = new Map([
      ['file:///a.jpg', new Uint8Array([1])],
      ['file:///b.jpg', new Uint8Array([2])],
      ['file:///c.jpg', new Uint8Array([3])]
    ])
    const createFile = vi.fn((uri: string) => {
      const bytes = bytesByUri.get(uri)!
      let read = false
      return {
        size: bytes.length,
        delete: vi.fn(),
        open: () => ({
          size: bytes.length,
          readBytes: () => {
            if (read) {
              return new Uint8Array()
            }
            read = true
            return bytes
          },
          close: vi.fn()
        })
      }
    })
    const launchLibrary = vi.fn().mockResolvedValue({
      canceled: false,
      assets: [...bytesByUri].map(([uri, bytes]) => ({ uri, fileSize: bytes.length }))
    })

    const result = await collectImages(
      pickMobileImages('library', {
        requestLibraryPermission: vi.fn().mockResolvedValue(granted),
        launchLibrary,
        createFile
      })
    )

    expect(result.map((image) => image.uri)).toEqual([
      'file:///a.jpg',
      'file:///b.jpg',
      'file:///c.jpg'
    ])
    expect(launchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 0
      })
    )
  })

  it('throws when photo library permission is denied', async () => {
    await expect(
      pickMobileImage('library', {
        requestLibraryPermission: vi.fn().mockResolvedValue(denied),
        launchLibrary: vi.fn()
      })
    ).rejects.toBeInstanceOf(ImageLibraryPermissionError)
  })

  it('returns null when the library picker is cancelled', async () => {
    const result = await pickMobileImage('library', {
      requestLibraryPermission: vi.fn().mockResolvedValue(granted),
      launchLibrary: vi.fn().mockResolvedValue({ canceled: true, assets: null })
    })

    expect(result).toBeNull()
  })

  it('reads a picked file URI into base64 for the files source', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = fileFactory(bytes)

    const result = await pickMobileImage('files', {
      launchFiles: vi.fn().mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'file:///doc.png', size: bytes.length }]
      }),
      createFile: file.createFile
    })

    expect(result).toEqual({
      base64: Buffer.from(bytes).toString('base64'),
      uri: 'file:///doc.png'
    })
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(file.deleteFile).not.toHaveBeenCalled()
  })

  it('deletes Harmony picker cache files after reading and records unavailable preview', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = fileFactory(bytes)

    const result = await pickMobileImage('files', {
      launchFiles: vi.fn().mockResolvedValue({
        canceled: false,
        assets: [
          {
            isTemporary: true,
            uri: 'file:///cache/orca-picked-image.heif',
            mimeType: 'image/heif',
            size: bytes.length
          }
        ]
      }),
      createFile: file.createFile
    })

    expect(result).toEqual({
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'image/heif',
      previewUri: null
    })
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(file.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('deletes Harmony library cache files after reading and records unavailable preview', async () => {
    const bytes = new Uint8Array([4, 3, 2, 1])
    const file = fileFactory(bytes)
    const getPreviewUri = vi.fn(async () => {
      expect(file.open).not.toHaveBeenCalled()
      throw new Error('preview decode failed')
    })

    const result = await pickMobileImage('library', {
      requestLibraryPermission: vi.fn().mockResolvedValue(granted),
      launchLibrary: vi.fn().mockResolvedValue({
        canceled: false,
        assets: [
          {
            isTemporary: true,
            getPreviewUri,
            uri: 'file:///cache/orca-picked-library-image.jpg',
            mimeType: 'image/jpeg',
            fileSize: bytes.length
          }
        ]
      }),
      createFile: file.createFile
    })

    expect(result).toEqual({
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'image/jpeg',
      previewUri: null
    })
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(file.deleteFile).toHaveBeenCalledTimes(1)
    expect(getPreviewUri).toHaveBeenCalledOnce()
  })

  it('returns null when the files picker is cancelled', async () => {
    const result = await pickMobileImage('files', {
      launchFiles: vi.fn().mockResolvedValue({ canceled: true, assets: null })
    })

    expect(result).toBeNull()
  })

  it('rejects an oversized asset before opening it', async () => {
    const file = fileFactory(new Uint8Array([1]))
    await expect(
      pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [{ uri: 'file:///huge.png', size: CLIPBOARD_IMAGE_MAX_SOURCE_BYTES + 1 }]
        }),
        createFile: file.createFile
      })
    ).rejects.toThrow('Clipboard image is too large')
    expect(file.createFile).not.toHaveBeenCalled()
    expect(file.open).not.toHaveBeenCalled()
  })

  it('deletes an oversized temporary Harmony picker file before rejecting it', async () => {
    const file = fileFactory(new Uint8Array([1]))
    const getPreviewUri = vi.fn()
    await expect(
      pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [
            {
              isTemporary: true,
              uri: 'file:///cache/orca-picked-huge.png',
              size: CLIPBOARD_IMAGE_MAX_SOURCE_BYTES + 1,
              getPreviewUri
            }
          ]
        }),
        createFile: file.createFile
      })
    ).rejects.toThrow('Clipboard image is too large')
    expect(file.open).not.toHaveBeenCalled()
    expect(file.deleteFile).toHaveBeenCalledTimes(1)
    expect(getPreviewUri).not.toHaveBeenCalled()
  })

  it('closes and deletes a temporary file whose open handle reports an oversized asset', async () => {
    const file = fileFactory(new Uint8Array([1]), {
      fileSize: 1,
      handleSize: CLIPBOARD_IMAGE_MAX_SOURCE_BYTES + 1
    })
    const getPreviewUri = vi.fn()
    await expect(
      pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [
            { isTemporary: true, uri: 'file:///cache/orca-picked-huge.png', size: 1, getPreviewUri }
          ]
        }),
        createFile: file.createFile
      })
    ).rejects.toThrow('Clipboard image is too large')
    expect(file.open).toHaveBeenCalledTimes(1)
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(file.deleteFile).toHaveBeenCalledTimes(1)
    expect(getPreviewUri).not.toHaveBeenCalled()
  })

  it('closes the file handle when reading fails', async () => {
    const file = fileFactory(new Uint8Array(), { fileSize: 4, readError: new Error('read failed') })
    await expect(
      pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [{ uri: 'file:///broken.png', size: 4 }]
        }),
        createFile: file.createFile
      })
    ).rejects.toThrow('read failed')
    expect(file.close).toHaveBeenCalledTimes(1)
  })

  it('deletes a temporary Harmony picker file when reading fails', async () => {
    const file = fileFactory(new Uint8Array(), { fileSize: 4, readError: new Error('read failed') })
    await expect(
      pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [{ isTemporary: true, uri: 'file:///cache/orca-picked-broken.png', size: 4 }]
        }),
        createFile: file.createFile
      })
    ).rejects.toThrow('read failed')
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(file.deleteFile).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    'keeps the read outcome when temporary cache cleanup fails (read failure: %s)',
    async (readFailure) => {
      const file = fileFactory(
        new Uint8Array([1]),
        readFailure ? { readError: new Error('read failed') } : undefined
      )
      file.deleteFile.mockImplementation(() => {
        throw new Error('cache deletion failed')
      })
      const picked = pickMobileImage('files', {
        launchFiles: vi.fn().mockResolvedValue({
          canceled: false,
          assets: [{ isTemporary: true, uri: 'file:///cache/picked.png', size: 1 }]
        }),
        createFile: file.createFile
      })
      if (readFailure) {
        await expect(picked).rejects.toThrow('read failed')
      } else {
        await expect(picked).resolves.toEqual({ base64: 'AQ==', previewUri: null })
      }
      expect(file.close).toHaveBeenCalledOnce()
      expect(file.deleteFile).toHaveBeenCalledOnce()
    }
  )

  it('deletes later temporary files when reading the second selection fails', async () => {
    const deleteByUri = new Map<string, ReturnType<typeof vi.fn>>()
    const createFile = vi.fn((uri: string) => {
      const deleteFile = deleteByUri.get(uri) ?? vi.fn()
      deleteByUri.set(uri, deleteFile)
      let read = false
      return {
        size: 1,
        delete: deleteFile,
        open: () => ({
          size: 1,
          readBytes: () => {
            if (uri.endsWith('/b.png')) {
              throw new Error('second read failed')
            }
            if (read) {
              return new Uint8Array()
            }
            read = true
            return new Uint8Array([1])
          },
          close: vi.fn()
        })
      }
    })
    const assets = ['a.png', 'b.png', 'c.png'].map((name) => ({
      isTemporary: true,
      uri: `file:///cache/${name}`,
      size: 1
    }))

    await expect(
      collectImages(
        pickMobileImages('files', {
          launchFiles: vi.fn().mockResolvedValue({ canceled: false, assets }),
          createFile
        })
      )
    ).rejects.toThrow('second read failed')

    expect(deleteByUri.get('file:///cache/a.png')).toHaveBeenCalledTimes(1)
    expect(deleteByUri.get('file:///cache/b.png')).toHaveBeenCalledTimes(1)
    expect(deleteByUri.get('file:///cache/c.png')).toHaveBeenCalledTimes(1)
  })

  it('deletes unconsumed temporary files when a multi-image consumer returns early', async () => {
    const deleteByUri = new Map<string, ReturnType<typeof vi.fn>>()
    const getPreviewUri = vi.fn(async () => 'data:image/png;base64,thumb')
    const createFile = vi.fn((uri: string) => {
      const deleteFile = deleteByUri.get(uri) ?? vi.fn()
      deleteByUri.set(uri, deleteFile)
      let read = false
      return {
        size: 1,
        delete: deleteFile,
        open: () => ({
          size: 1,
          readBytes: () => {
            if (read) {
              return new Uint8Array()
            }
            read = true
            return new Uint8Array([1])
          },
          close: vi.fn()
        })
      }
    })
    const assets = ['a.png', 'b.png', 'c.png'].map((name) => ({
      isTemporary: true,
      uri: `file:///cache/${name}`,
      size: 1,
      getPreviewUri
    }))
    const iterator = pickMobileImages('files', {
      launchFiles: vi.fn().mockResolvedValue({ canceled: false, assets }),
      createFile
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { base64: 'AQ==', previewUri: 'data:image/png;base64,thumb' }
    })
    await iterator.return?.()

    expect(deleteByUri.get('file:///cache/a.png')).toHaveBeenCalledTimes(1)
    expect(deleteByUri.get('file:///cache/b.png')).toHaveBeenCalledTimes(1)
    expect(deleteByUri.get('file:///cache/c.png')).toHaveBeenCalledTimes(1)
    expect(getPreviewUri).toHaveBeenCalledOnce()
  })

  it('uploads original bytes while retaining only the generated Harmony preview', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6])
    const file = fileFactory(original)
    const getPreviewUri = vi.fn(async () => {
      expect(file.deleteFile).not.toHaveBeenCalled()
      return 'data:image/png;base64,thumb'
    })
    const sendRequest = vi.fn(async (method: string, params?: { contentBase64?: string }) => {
      if (method === 'clipboard.startImageUpload') {
        return { id: 'start', ok: false, error: { code: 'method_not_found', message: '' } }
      }
      expect(method).toBe('clipboard.saveImageAsTempFile')
      expect(params?.contentBase64).toBe(Buffer.from(original).toString('base64'))
      return { id: 'save', ok: true, result: '/tmp/original.png' }
    })
    const uploaded = await uploadMobileNativeChatImages('files', {
      client: { sendRequest } as never,
      getConnectionId: async () => null,
      pickImages: () =>
        pickMobileImages('files', {
          launchFiles: vi.fn().mockResolvedValue({
            canceled: false,
            assets: [
              {
                uri: 'file:///cache/orca-picked-image.png',
                size: original.length,
                isTemporary: true,
                getPreviewUri
              }
            ]
          }),
          createFile: file.createFile
        })
    })

    expect(uploaded).toEqual([
      { path: '/tmp/original.png', previewUri: 'data:image/png;base64,thumb' }
    ])
    expect(getPreviewUri).toHaveBeenCalledOnce()
    expect(file.deleteFile).toHaveBeenCalledOnce()
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
})
