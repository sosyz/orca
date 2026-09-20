import { IMAGE_FILE_MIME_TYPES } from './image-file-extensions'

export type RasterImageFileFormat = {
  readonly extension: string
  readonly mimeType: string
}

const PNG = { extension: '.png', mimeType: IMAGE_FILE_MIME_TYPES['.png'] }
const JPEG = { extension: '.jpg', mimeType: IMAGE_FILE_MIME_TYPES['.jpg'] }
const GIF = { extension: '.gif', mimeType: IMAGE_FILE_MIME_TYPES['.gif'] }
const WEBP = { extension: '.webp', mimeType: IMAGE_FILE_MIME_TYPES['.webp'] }
const BMP = { extension: '.bmp', mimeType: IMAGE_FILE_MIME_TYPES['.bmp'] }
const HEIC = { extension: '.heic', mimeType: 'image/heic' }
const HEIF = { extension: '.heif', mimeType: 'image/heif' }
const HEIC_SEQUENCE = { extension: '.heics', mimeType: 'image/heic-sequence' }
const HEIF_SEQUENCE = { extension: '.heifs', mimeType: 'image/heif-sequence' }
const SUPPORTED_MIME_TYPES = new Set(
  [PNG, JPEG, GIF, WEBP, BMP, HEIC, HEIF, HEIC_SEQUENCE, HEIF_SEQUENCE].map(
    (format) => format.mimeType
  )
)
const HEIC_BRANDS = new Set(['heic', 'heix'])
const HEIC_SEQUENCE_BRANDS = new Set(['hevc', 'hevx'])
const BMFF_HEADER_MAX_BYTES = 256

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) {
    return false
  }
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false
    }
  }
  return true
}

function readAscii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  )
}

function detectHeifFormat(bytes: Uint8Array): RasterImageFileFormat | null {
  if (bytes.length < 16 || !matchesAscii(bytes, 4, 'ftyp')) {
    return null
  }
  const boxSize =
    (((bytes[0]! << 24) >>> 0) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
  if (
    boxSize < 16 ||
    boxSize > bytes.length ||
    boxSize > BMFF_HEADER_MAX_BYTES ||
    boxSize % 4 !== 0
  ) {
    return null
  }

  let hasHeic = false
  let hasHeif = false
  let hasHeicSequence = false
  let hasHeifSequence = false
  let hasAvif = false
  for (let offset = 8; offset + 4 <= boxSize; offset = offset === 8 ? 16 : offset + 4) {
    const brand = readAscii(bytes, offset)
    hasHeic ||= HEIC_BRANDS.has(brand)
    hasHeif ||= brand === 'mif1'
    hasHeicSequence ||= HEIC_SEQUENCE_BRANDS.has(brand)
    hasHeifSequence ||= brand === 'msf1'
    hasAvif ||= brand === 'avif' || brand === 'avis'
  }
  if (hasAvif) {
    return null
  }
  return hasHeic
    ? HEIC
    : hasHeicSequence
      ? HEIC_SEQUENCE
      : hasHeif
        ? HEIF
        : hasHeifSequence
          ? HEIF_SEQUENCE
          : null
}

export function detectRasterImageFileFormat(bytes: Uint8Array): RasterImageFileFormat | null {
  if (bytes.length >= 8 && bytes[0] === 137 && matchesAscii(bytes, 1, 'PNG\r\n\x1a\n')) {
    return PNG
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return JPEG
  }
  if (matchesAscii(bytes, 0, 'GIF87a') || matchesAscii(bytes, 0, 'GIF89a')) {
    return GIF
  }
  if (matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP')) {
    return WEBP
  }
  if (bytes.length >= 4 && matchesAscii(bytes, 0, 'BM')) {
    return BMP
  }
  return detectHeifFormat(bytes)
}

export function normalizeSupportedRasterImageMimeType(
  mimeType: string | undefined
): string | undefined {
  const normalized = mimeType?.trim().toLowerCase()
  return normalized && SUPPORTED_MIME_TYPES.has(normalized) ? normalized : undefined
}
