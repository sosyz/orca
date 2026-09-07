import { describe, expect, it, vi } from 'vitest'
import { websocketPayloadToUint8 } from './websocket-payload-bytes'

describe('websocketPayloadToUint8', () => {
  it('rejects known and converted sizes above the allocation budget', async () => {
    const convertKnownOversize = vi.fn(async () => new ArrayBuffer(1))

    await expect(websocketPayloadToUint8(new Uint8Array(3), 2)).resolves.toBeNull()
    await expect(
      websocketPayloadToUint8({ size: 3, arrayBuffer: convertKnownOversize }, 2)
    ).resolves.toBeNull()
    expect(convertKnownOversize).not.toHaveBeenCalled()
    await expect(
      websocketPayloadToUint8({ arrayBuffer: async () => new ArrayBuffer(3) }, 2)
    ).resolves.toBeNull()
  })

  it('returns null when a blob-like payload rejects arrayBuffer conversion', async () => {
    await expect(
      websocketPayloadToUint8({
        arrayBuffer: async () => {
          throw new Error('conversion failed')
        }
      })
    ).resolves.toBeNull()
  })
})
