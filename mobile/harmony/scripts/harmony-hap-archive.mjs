import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const MAX_END_RECORD_SIZE = 65_557
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const SIGNING_BLOCK_DESCRIPTOR_BYTES = 12
const SIGNING_BLOCK_FOOTER_BYTES = 32
const SIGNING_BLOCK_MAGIC = new Map([
  [2, Buffer.from('HAP Sig Block 42')],
  [3, Buffer.from('<hap sign block>')]
])

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let checksum = value
  for (let bit = 0; bit < 8; bit += 1) {
    checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  return checksum >>> 0
})

function assertRange(archive, offset, length, message) {
  if (offset < 0 || length < 0 || offset + length > archive.length) {
    throw new Error(message)
  }
}

function findEndOfCentralDirectory(archive) {
  if (archive.length < 22) {
    throw new Error('HAP is not a valid ZIP archive')
  }
  const lowerBound = Math.max(0, archive.length - MAX_END_RECORD_SIZE)
  for (let offset = archive.length - 22; offset >= lowerBound; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      return offset
    }
  }
  throw new Error('HAP is not a valid ZIP archive')
}

function assertSafeEntryName(name) {
  const segments = name.replaceAll('\\', '/').split('/')
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    segments.includes('..')
  ) {
    throw new Error(`HAP contains an unsafe entry path: ${name}`)
  }
}

function parseEntries(archive) {
  const endOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(endOffset + 4)
  const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6)
  const diskEntryCount = archive.readUInt16LE(endOffset + 8)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16)

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0xffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('Multi-disk and ZIP64 HAP archives are not supported')
  }
  if (centralDirectoryOffset + centralDirectorySize !== endOffset) {
    throw new Error('HAP central directory does not end at the archive footer')
  }

  const entries = new Map()
  let totalUncompressedBytes = 0
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(archive, offset, 46, 'HAP central directory is malformed')
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('HAP central directory is malformed')
    }
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const crc32 = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    assertRange(
      archive,
      nameStart,
      nameLength + extraLength + commentLength,
      'HAP central directory entry is truncated'
    )
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8')

    assertSafeEntryName(name)
    if ((flags & 1) !== 0) {
      throw new Error(`Encrypted HAP entry is not supported: ${name}`)
    }
    if (![0, 8].includes(method)) {
      throw new Error(`Unsupported HAP compression method ${method}: ${name}`)
    }
    if (compressedSize > MAX_ENTRY_BYTES || uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(`HAP entry exceeds the archive size limit: ${name}`)
    }
    totalUncompressedBytes += uncompressedSize
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('HAP uncompressed content exceeds the archive size limit')
    }
    if (entries.has(name)) {
      throw new Error(`HAP contains a duplicate entry: ${name}`)
    }
    entries.set(name, {
      compressedSize,
      crc32,
      flags,
      localHeaderOffset,
      method,
      uncompressedSize
    })
    offset = nameStart + nameLength + extraLength + commentLength
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error('HAP central directory size does not match its entries')
  }
  assertContiguousLocalEntries(archive, entries, centralDirectoryOffset)
  return entries
}

function assertContiguousLocalEntries(archive, entries, centralDirectoryOffset) {
  const ranges = []
  for (const [name, entry] of entries) {
    const { compressedSize, crc32, flags, localHeaderOffset, method, uncompressedSize } = entry
    assertRange(archive, localHeaderOffset, 30, `HAP local header is malformed: ${name}`)
    if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`HAP local header is malformed: ${name}`)
    }
    if ((flags & 0x08) !== 0) {
      throw new Error(`HAP data descriptors are not supported: ${name}`)
    }
    const localFlags = archive.readUInt16LE(localHeaderOffset + 6)
    const localMethod = archive.readUInt16LE(localHeaderOffset + 8)
    const localCrc32 = archive.readUInt32LE(localHeaderOffset + 14)
    const localCompressedSize = archive.readUInt32LE(localHeaderOffset + 18)
    const localUncompressedSize = archive.readUInt32LE(localHeaderOffset + 22)
    const nameLength = archive.readUInt16LE(localHeaderOffset + 26)
    const extraLength = archive.readUInt16LE(localHeaderOffset + 28)
    const nameStart = localHeaderOffset + 30
    assertRange(
      archive,
      nameStart,
      nameLength + extraLength + compressedSize,
      `HAP local entry is truncated: ${name}`
    )
    const localName = archive.subarray(nameStart, nameStart + nameLength).toString('utf8')
    if (
      localName !== name ||
      localFlags !== flags ||
      localMethod !== method ||
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`HAP local header does not match the central directory: ${name}`)
    }
    ranges.push({
      end: nameStart + nameLength + extraLength + compressedSize,
      name,
      start: localHeaderOffset
    })
  }

  ranges.sort((left, right) => left.start - right.start)
  let cursor = 0
  for (const range of ranges) {
    if (range.start !== cursor) {
      throw new Error(`HAP contains uncovered or overlapping archive bytes near: ${range.name}`)
    }
    cursor = range.end
  }
  if (cursor !== centralDirectoryOffset) {
    assertHarmonySigningBlock(archive, cursor, centralDirectoryOffset)
  }
}

function assertHarmonySigningBlock(archive, start, end) {
  const length = end - start
  if (length < SIGNING_BLOCK_FOOTER_BYTES) {
    throw new Error('HAP contains an invalid signing block')
  }
  const footerOffset = end - SIGNING_BLOCK_FOOTER_BYTES
  const descriptorCount = archive.readUInt32LE(footerOffset)
  const declaredLength = archive.readBigUInt64LE(footerOffset + 4)
  const version = archive.readUInt32LE(end - 4)
  const expectedMagic = SIGNING_BLOCK_MAGIC.get(version)
  const magic = archive.subarray(footerOffset + 12, footerOffset + 28)
  if (
    descriptorCount === 0 ||
    descriptorCount > Math.floor((length - SIGNING_BLOCK_FOOTER_BYTES) / 12) ||
    declaredLength !== BigInt(length) ||
    !expectedMagic ||
    !magic.equals(expectedMagic)
  ) {
    throw new Error('HAP contains an invalid signing block footer')
  }

  const descriptorBytes = descriptorCount * SIGNING_BLOCK_DESCRIPTOR_BYTES
  const ranges = []
  const types = new Set()
  for (let index = 0; index < descriptorCount; index += 1) {
    const descriptorOffset = start + index * SIGNING_BLOCK_DESCRIPTOR_BYTES
    const type = archive.readUInt32LE(descriptorOffset)
    const valueLength = archive.readUInt32LE(descriptorOffset + 4)
    const valueOffset = archive.readUInt32LE(descriptorOffset + 8)
    const valueStart = start + valueOffset
    const valueEnd = valueStart + valueLength
    if (
      type === 0 ||
      types.has(type) ||
      valueLength === 0 ||
      valueOffset < descriptorBytes ||
      valueEnd > footerOffset
    ) {
      throw new Error('HAP contains an invalid signing block descriptor')
    }
    types.add(type)
    ranges.push({ end: valueEnd, start: valueStart })
  }

  ranges.sort((left, right) => left.start - right.start)
  let cursor = start + descriptorBytes
  for (const range of ranges) {
    if (range.start !== cursor) {
      throw new Error('HAP signing block contains uncovered or overlapping bytes')
    }
    cursor = range.end
  }
  if (cursor !== footerOffset) {
    throw new Error('HAP signing block does not end at its footer')
  }
}

export function openHarmonyHapArchive(path) {
  const archive = readFileSync(path)
  const entries = parseEntries(archive)

  return {
    entryNames: [...entries.keys()],
    readEntry(name) {
      const entry = entries.get(name)
      if (!entry) {
        throw new Error(`HAP entry is missing: ${name}`)
      }
      const { compressedSize, crc32, flags, localHeaderOffset, method, uncompressedSize } = entry
      assertRange(archive, localHeaderOffset, 30, `HAP local header is malformed: ${name}`)
      if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
        throw new Error(`HAP local header is malformed: ${name}`)
      }
      const localFlags = archive.readUInt16LE(localHeaderOffset + 6)
      const localMethod = archive.readUInt16LE(localHeaderOffset + 8)
      const localCrc32 = archive.readUInt32LE(localHeaderOffset + 14)
      const localCompressedSize = archive.readUInt32LE(localHeaderOffset + 18)
      const localUncompressedSize = archive.readUInt32LE(localHeaderOffset + 22)
      const nameLength = archive.readUInt16LE(localHeaderOffset + 26)
      const extraLength = archive.readUInt16LE(localHeaderOffset + 28)
      const nameStart = localHeaderOffset + 30
      assertRange(
        archive,
        nameStart,
        nameLength + extraLength,
        `HAP local header is truncated: ${name}`
      )
      const localName = archive.subarray(nameStart, nameStart + nameLength).toString('utf8')
      if (localName !== name || localFlags !== flags || localMethod !== method) {
        throw new Error(`HAP local header does not match the central directory: ${name}`)
      }
      if (
        localCrc32 !== crc32 ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize
      ) {
        throw new Error(`HAP local header metadata mismatch: ${name}`)
      }
      const dataStart = localHeaderOffset + 30 + nameLength + extraLength
      assertRange(archive, dataStart, compressedSize, `HAP entry data is truncated: ${name}`)
      const compressed = archive.subarray(dataStart, dataStart + compressedSize)
      let content
      try {
        content = method === 0 ? compressed : inflateRawSync(compressed)
      } catch {
        throw new Error(`HAP entry cannot be decompressed: ${name}`)
      }
      if (content.length !== uncompressedSize) {
        throw new Error(`HAP entry size mismatch: ${name}`)
      }
      if (calculateCrc32(content) !== crc32) {
        throw new Error(`HAP entry checksum mismatch: ${name}`)
      }
      return content
    }
  }
}

function calculateCrc32(content) {
  let checksum = 0xffffffff
  for (const byte of content) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }
  return (checksum ^ 0xffffffff) >>> 0
}
