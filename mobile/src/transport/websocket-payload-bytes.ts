export async function websocketPayloadToUint8(
  value: unknown,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Uint8Array | null> {
  if (value instanceof Uint8Array) {
    return value.byteLength <= maxBytes ? value : null
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength <= maxBytes ? new Uint8Array(value) : null
  }
  if (value && typeof value === 'object' && 'arrayBuffer' in value) {
    const blob = value as { arrayBuffer: () => Promise<ArrayBuffer>; size?: unknown }
    if (typeof blob.size === 'number' && blob.size > maxBytes) {
      return null
    }
    try {
      const buffer = await blob.arrayBuffer()
      return buffer.byteLength <= maxBytes ? new Uint8Array(buffer) : null
    } catch {
      return null
    }
  }
  if (typeof FileReader !== 'undefined' && value instanceof Blob) {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(
          reader.result instanceof ArrayBuffer && reader.result.byteLength <= maxBytes
            ? new Uint8Array(reader.result)
            : null
        )
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(value)
    })
  }
  return null
}
