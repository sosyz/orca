type RuntimeTextDecoder = {
  decode: (input: Uint8Array) => string
}

type RuntimeTextDecoderConstructor = new () => RuntimeTextDecoder

export function decodeUtf8Text(bytes: Uint8Array): string {
  try {
    const Decoder = (globalThis as unknown as { TextDecoder?: RuntimeTextDecoderConstructor })
      .TextDecoder
    if (typeof Decoder === 'function') {
      return new Decoder().decode(bytes)
    }
  } catch {
    // Hermes does not expose TextDecoder on every HarmonyOS runtime.
  }
  return decodeUtf8TextFallback(bytes)
}

function decodeUtf8TextFallback(bytes: Uint8Array): string {
  let output = ''
  let codePoint = 0
  let bytesNeeded = 0
  let bytesSeen = 0
  let lowerBoundary = 0x80
  let upperBoundary = 0xbf
  let atStart = true

  const append = (value: number): void => {
    if (atStart) {
      atStart = false
      if (value === 0xfeff) {
        return
      }
    }
    output += String.fromCodePoint(value)
  }

  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!
    if (bytesNeeded === 0) {
      if (byte <= 0x7f) {
        append(byte)
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        bytesNeeded = 1
        codePoint = byte & 0x1f
      } else if (byte >= 0xe0 && byte <= 0xef) {
        bytesNeeded = 2
        codePoint = byte & 0x0f
        lowerBoundary = byte === 0xe0 ? 0xa0 : 0x80
        upperBoundary = byte === 0xed ? 0x9f : 0xbf
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        bytesNeeded = 3
        codePoint = byte & 0x07
        lowerBoundary = byte === 0xf0 ? 0x90 : 0x80
        upperBoundary = byte === 0xf4 ? 0x8f : 0xbf
      } else {
        append(0xfffd)
      }
      continue
    }

    if (byte < lowerBoundary || byte > upperBoundary) {
      append(0xfffd)
      codePoint = 0
      bytesNeeded = 0
      bytesSeen = 0
      lowerBoundary = 0x80
      upperBoundary = 0xbf
      index--
      continue
    }

    lowerBoundary = 0x80
    upperBoundary = 0xbf
    codePoint = (codePoint << 6) | (byte & 0x3f)
    bytesSeen++
    if (bytesSeen === bytesNeeded) {
      append(codePoint)
      codePoint = 0
      bytesNeeded = 0
      bytesSeen = 0
    }
  }

  if (bytesNeeded !== 0) {
    append(0xfffd)
  }
  return output
}
