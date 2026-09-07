import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32)
  }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => raw.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes
}))

class ReentrantReadyWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = ReentrantReadyWebSocket.CONNECTING
  readonly OPEN = ReentrantReadyWebSocket.OPEN
  readonly CLOSING = ReentrantReadyWebSocket.CLOSING
  readonly CLOSED = ReentrantReadyWebSocket.CLOSED
  readyState = ReentrantReadyWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: string[] = []
  readonly droppedNestedSends: string[] = []
  private sending = false

  constructor(readonly endpoint: string) {
    sockets.push(this)
  }

  send(payload: string): void {
    if (this.sending) {
      this.droppedNestedSends.push(payload)
      return
    }
    this.sent.push(payload)
    if (payload.includes('e2ee_hello')) {
      this.sending = true
      try {
        this.onmessage?.({ data: JSON.stringify({ type: 'e2ee_ready' }) })
      } finally {
        this.sending = false
      }
    } else if (payload.includes('e2ee_auth')) {
      this.onmessage?.({ data: 'encrypted:{"type":"e2ee_authenticated"}' })
    }
  }

  close(): void {
    this.readyState = ReentrantReadyWebSocket.CLOSED
  }

  open(): void {
    this.readyState = ReentrantReadyWebSocket.OPEN
    this.onopen?.()
  }
}

const sockets: ReentrantReadyWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

describe('rpc-client reentrant handshake', () => {
  beforeEach(() => {
    sockets.length = 0
    globalThis.WebSocket = ReentrantReadyWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('defers and deduplicates auth when ready arrives before hello send returns', async () => {
    const client = connect('ws://desktop.invalid', 'device-token', 'server-key')
    const socket = sockets[0]!

    socket.open()
    socket.onmessage?.({ data: JSON.stringify({ type: 'e2ee_ready' }) })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(
      socket.sent.filter(
        (payload) => payload === 'encrypted:{"type":"e2ee_auth","deviceToken":"device-token"}'
      )
    ).toHaveLength(1)
    expect(socket.droppedNestedSends).toEqual([])
    expect(client.getState()).toBe('connected')
    client.close()
  })
})
