import { describe, expect, it } from 'vitest'
import {
  detectRasterImageFileFormat,
  normalizeSupportedRasterImageMimeType
} from './raster-image-format'

function ftyp(majorBrand: string, ...compatibleBrands: string[]): Uint8Array {
  const bytes = Buffer.alloc(16 + compatibleBrands.length * 4)
  bytes.writeUInt32BE(bytes.length, 0)
  bytes.write('ftyp', 4)
  bytes.write(majorBrand, 8)
  compatibleBrands.forEach((brand, index) => bytes.write(brand, 16 + index * 4))
  return bytes
}

describe('raster image file format', () => {
  it.each([
    [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), '.png', 'image/png'],
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg', 'image/jpeg'],
    [Buffer.from('GIF89a'), '.gif', 'image/gif'],
    [Buffer.from('RIFF\x04\x00\x00\x00WEBP'), '.webp', 'image/webp'],
    [Uint8Array.from([0x42, 0x4d, 0, 0]), '.bmp', 'image/bmp']
  ])('detects a common image signature', (bytes, extension, mimeType) => {
    expect(detectRasterImageFileFormat(bytes)).toEqual({ extension, mimeType })
  })

  it.each(['heic', 'heix'])('detects HEIC major brand %s', (brand) => {
    expect(detectRasterImageFileFormat(ftyp(brand))).toEqual({
      extension: '.heic',
      mimeType: 'image/heic'
    })
  })

  it.each(['hevc', 'hevx'])('detects HEIC sequence major brand %s', (brand) => {
    expect(detectRasterImageFileFormat(ftyp(brand))).toEqual({
      extension: '.heics',
      mimeType: 'image/heic-sequence'
    })
  })

  it('detects a generic HEIF major brand', () => {
    expect(detectRasterImageFileFormat(ftyp('mif1'))).toEqual({
      extension: '.heif',
      mimeType: 'image/heif'
    })
  })

  it('detects a generic HEIF sequence major brand', () => {
    expect(detectRasterImageFileFormat(ftyp('msf1'))).toEqual({
      extension: '.heifs',
      mimeType: 'image/heif-sequence'
    })
  })

  it('does not treat an unregistered heif brand as proof of a HEIF file', () => {
    expect(detectRasterImageFileFormat(ftyp('heif'))).toBeNull()
  })

  it('prefers a compatible HEIC brand over a generic HEIF major brand', () => {
    expect(detectRasterImageFileFormat(ftyp('mif1', 'heic'))).toEqual({
      extension: '.heic',
      mimeType: 'image/heic'
    })
  })

  it('prefers a compatible HEIC sequence brand over a generic HEIF sequence major brand', () => {
    expect(detectRasterImageFileFormat(ftyp('msf1', 'hevc'))).toEqual({
      extension: '.heics',
      mimeType: 'image/heic-sequence'
    })
  })

  it('finds a HEIF compatible brand behind a generic major brand', () => {
    expect(detectRasterImageFileFormat(ftyp('isom', 'mif1'))).toEqual({
      extension: '.heif',
      mimeType: 'image/heif'
    })
  })

  it('does not mislabel AVIF or malformed BMFF as HEIF', () => {
    expect(detectRasterImageFileFormat(ftyp('avif', 'mif1'))).toBeNull()
    expect(detectRasterImageFileFormat(ftyp('avis', 'msf1'))).toBeNull()
    expect(detectRasterImageFileFormat(ftyp('mif1', ...Array(60).fill('isom'), 'avif'))).toBeNull()
    const malformed = ftyp('heic')
    malformed[3] = 2
    expect(detectRasterImageFileFormat(malformed)).toBeNull()
  })

  it.each([new Uint8Array(), Buffer.from('RIFF'), Buffer.from('GIF89'), Buffer.from('ftyp')])(
    'returns unknown for a short header without throwing',
    (bytes) => {
      expect(detectRasterImageFileFormat(bytes)).toBeNull()
    }
  )

  it('only preserves supported MIME types for inline previews', () => {
    expect(normalizeSupportedRasterImageMimeType(' IMAGE/HEIC ')).toBe('image/heic')
    expect(normalizeSupportedRasterImageMimeType('IMAGE/HEIC-SEQUENCE')).toBe('image/heic-sequence')
    expect(normalizeSupportedRasterImageMimeType('text/html')).toBeUndefined()
    expect(normalizeSupportedRasterImageMimeType('image/png;foo=bar')).toBeUndefined()
  })
})
