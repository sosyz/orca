import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(() => '/tmp/orca'),
  requireSshFilesystemProvider: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('node:fs/promises', () => ({ default: { writeFile: mocks.writeFile } }))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: mocks.getPath })
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: mocks.requireSshFilesystemProvider
}))

import { saveClipboardImageBufferAsTempFile } from './clipboard-image-temp-file'

describe('clipboard image temp file format', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeFile.mockResolvedValue(undefined)
  })

  it.each([
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), '.png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg'],
    [Buffer.from('GIF89a'), '.gif'],
    [Buffer.from('RIFF\x04\x00\x00\x00WEBP'), '.webp']
  ])('writes local bytes unchanged with their detected extension', async (bytes, extension) => {
    const result = await saveClipboardImageBufferAsTempFile(bytes)

    expect(path.extname(result)).toBe(extension)
    expect(mocks.writeFile).toHaveBeenCalledWith(result, bytes)
    expect(mocks.writeFile.mock.calls[0]![1]).toBe(bytes)
  })

  it('uses the detected HEIC extension for SSH without changing uploaded bytes', async () => {
    const bytes = Buffer.alloc(16)
    bytes.writeUInt32BE(16)
    bytes.write('ftypheic', 4)
    const writeFileBase64 = vi.fn().mockResolvedValue(undefined)
    mocks.requireSshFilesystemProvider.mockReturnValue({
      getTempDir: async () => '/var/tmp',
      writeFileBase64
    })

    const result = await saveClipboardImageBufferAsTempFile(bytes, { connectionId: 'ssh-1' })

    expect(result).toMatch(/^\/var\/tmp\/orca-paste-.*\.heic$/)
    expect(mocks.requireSshFilesystemProvider).toHaveBeenCalledWith('ssh-1')
    expect(writeFileBase64).toHaveBeenCalledWith(result, bytes.toString('base64'))
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('writes a local HEIF file with the original bytes', async () => {
    const bytes = Buffer.alloc(16)
    bytes.writeUInt32BE(16)
    bytes.write('ftypmif1', 4)

    const result = await saveClipboardImageBufferAsTempFile(bytes)

    expect(path.extname(result)).toBe('.heif')
    expect(mocks.writeFile).toHaveBeenCalledWith(result, bytes)
  })

  it('keeps the old PNG fallback for unknown and truncated headers', async () => {
    for (const bytes of [Buffer.from([1, 2, 3]), Buffer.from('ftyp')]) {
      const result = await saveClipboardImageBufferAsTempFile(bytes)
      expect(path.extname(result)).toBe('.png')
      expect(mocks.writeFile).toHaveBeenCalledWith(result, bytes)
    }
  })
})
