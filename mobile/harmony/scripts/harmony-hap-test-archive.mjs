const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let checksum = value
  for (let bit = 0; bit < 8; bit += 1) {
    checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  return checksum >>> 0
})

function crc32(content) {
  let checksum = 0xffffffff
  for (const byte of content) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

export function createStoredHap(entries, { dosDate = 0, dosTime = 0 } = {}) {
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const [name, value] of Object.entries(entries)) {
    const fileName = Buffer.from(name)
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value)
    const checksum = crc32(content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(fileName.length, 26)
    localParts.push(localHeader, fileName, content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(fileName.length, 28)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, fileName)
    localOffset += localHeader.length + fileName.length + content.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}
