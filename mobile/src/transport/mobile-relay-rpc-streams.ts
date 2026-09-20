import { decodeBrowserScreencastFrame } from './browser-screencast-protocol'
import {
  handleTerminalBinaryFrame,
  type TerminalSnapshotState
} from './rpc-client-terminal-binary-frame'
import {
  buildStreamUnsubscribe,
  buildTerminalUnsubscribeParams,
  updateTerminalSubscriptionViewport
} from './rpc-client-terminal-subscription'
import { buildReadyStreamUnsubscribe } from './rpc-client-server-subscription'
import type { RpcClient } from './rpc-client'
import type { RpcResponse, RpcSuccess } from './types'

type StreamRecord = {
  method: string
  params: unknown
  listener: (result: unknown) => void
  onBinaryFrame?: Parameters<RpcClient['subscribe']>[3] extends
    | { onBinaryFrame?: infer Listener }
    | undefined
    ? Listener
    : never
  streamIds: Set<number>
  subscriptionId?: string
  cancelled: boolean
  sent: boolean
}

type StreamManagerOptions = {
  nextId: () => string
  sendFrame: (request: { id: string; method: string; params?: unknown }) => boolean
  waitForConnected: () => Promise<void>
}

export class MobileRelayRpcStreams {
  private readonly streams = new Map<string, StreamRecord>()
  private readonly terminalListeners = new Map<number, (result: unknown) => void>()
  private readonly terminalSnapshots = new Map<number, TerminalSnapshotState>()
  private activeBrowserRequestId: string | null = null
  private pendingBrowserRequestId: string | null = null

  constructor(private readonly options: StreamManagerOptions) {}

  subscribe(
    method: string,
    params: unknown,
    listener: (result: unknown) => void,
    subscribeOptions?: Parameters<RpcClient['subscribe']>[3]
  ): () => void {
    const id = this.options.nextId()
    const stream: StreamRecord = {
      method,
      params,
      listener,
      onBinaryFrame: subscribeOptions?.onBinaryFrame,
      streamIds: new Set(),
      cancelled: false,
      sent: false
    }
    this.streams.set(id, stream)
    if (method === 'browser.screencast') {
      this.replaceBrowserStream(id)
    }
    void this.options
      .waitForConnected()
      .then(() => {
        if (!stream.cancelled) {
          if (this.options.sendFrame({ id, method, params: stream.params })) {
            stream.sent = true
          } else {
            this.fail(id, stream, 'Connection interrupted')
          }
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Connection interrupted'
        this.fail(id, stream, message, error)
      })
    return () => this.cancel(id)
  }

  updateTerminalViewport(terminal: string, viewport: { cols: number; rows: number }): void {
    updateTerminalSubscriptionViewport(this.streams.values(), terminal, viewport)
  }

  handleResponse(response: RpcResponse): boolean {
    const stream = this.streams.get(response.id)
    if (!stream) {
      return false
    }
    if (!response.ok) {
      if (stream.cancelled) {
        this.remove(response.id)
        return true
      }
      this.fail(response.id, stream, response.error.message, response.error)
      return true
    }
    const result = (response as RpcSuccess).result
    if (result && typeof result === 'object') {
      const metadata = result as { subscriptionId?: unknown; streamId?: unknown; type?: unknown }
      if (typeof metadata.subscriptionId === 'string') {
        stream.subscriptionId = metadata.subscriptionId
        if (stream.cancelled) {
          this.sendServerSubscriptionUnsubscribe(stream)
          this.remove(response.id)
          return true
        }
      }
      if (typeof metadata.streamId === 'number') {
        stream.streamIds.add(metadata.streamId)
        this.terminalListeners.set(metadata.streamId, stream.listener)
      }
      if (stream.method === 'browser.screencast' && stream.subscriptionId) {
        if (
          this.pendingBrowserRequestId !== response.id &&
          this.activeBrowserRequestId !== response.id
        ) {
          this.sendServerSubscriptionUnsubscribe(stream)
          this.remove(response.id)
          return true
        }
        this.pendingBrowserRequestId = null
        this.activeBrowserRequestId = response.id
      }
      if (metadata.type === 'end') {
        stream.listener(result)
        this.remove(response.id)
        return true
      }
    }
    if (!stream.cancelled) {
      stream.listener(result)
    }
    return true
  }

  handleBinary(bytes: Uint8Array): void {
    const browserFrame = decodeBrowserScreencastFrame(bytes)
    const activeBrowserStream = this.activeBrowserRequestId
      ? this.streams.get(this.activeBrowserRequestId)
      : null
    if (browserFrame && activeBrowserStream?.onBinaryFrame && !activeBrowserStream.cancelled) {
      activeBrowserStream.onBinaryFrame(browserFrame)
      return
    }
    handleTerminalBinaryFrame(bytes, {
      terminalSnapshots: this.terminalSnapshots,
      getListener: (streamId) => this.terminalListeners.get(streamId)
    })
  }

  clear(): void {
    for (const stream of this.streams.values()) {
      stream.cancelled = true
    }
    this.streams.clear()
    this.terminalListeners.clear()
    this.terminalSnapshots.clear()
    this.activeBrowserRequestId = null
    this.pendingBrowserRequestId = null
  }

  private cancel(id: string): void {
    const stream = this.streams.get(id)
    if (!stream || stream.cancelled) {
      return
    }
    stream.cancelled = true
    if (stream.method === 'browser.screencast') {
      this.clearBrowserRequest(id)
    }
    if (!stream.sent) {
      this.remove(id)
      return
    }
    const unsubscribe = buildStreamUnsubscribe(stream.method, stream.params)
    if (stream.method === 'terminal.subscribe') {
      const params = buildTerminalUnsubscribeParams(stream.params)
      if (params) {
        this.options.sendFrame({
          id: this.options.nextId(),
          method: 'terminal.unsubscribe',
          params
        })
      }
    } else if (unsubscribe) {
      this.options.sendFrame({ id: this.options.nextId(), ...unsubscribe })
    } else if (stream.subscriptionId) {
      this.sendServerSubscriptionUnsubscribe(stream)
    } else if (buildReadyStreamUnsubscribe(stream.method, 'pending-subscription')) {
      return
    }
    this.remove(id)
  }

  private replaceBrowserStream(id: string): void {
    if (this.activeBrowserRequestId && this.activeBrowserRequestId !== id) {
      this.cancel(this.activeBrowserRequestId)
    }
    if (this.pendingBrowserRequestId && this.pendingBrowserRequestId !== id) {
      this.cancel(this.pendingBrowserRequestId)
    }
    this.pendingBrowserRequestId = id
    this.activeBrowserRequestId = null
  }

  private sendServerSubscriptionUnsubscribe(stream: StreamRecord): void {
    if (!stream.subscriptionId) {
      return
    }
    const unsubscribe =
      buildReadyStreamUnsubscribe(stream.method, stream.subscriptionId) ??
      (stream.method.endsWith('.subscribe')
        ? {
            method: stream.method.replace(/\.subscribe$/, '.unsubscribe'),
            params: { subscriptionId: stream.subscriptionId }
          }
        : null)
    if (unsubscribe) {
      this.options.sendFrame({ id: this.options.nextId(), ...unsubscribe })
    }
  }

  private remove(id: string): void {
    const stream = this.streams.get(id)
    if (!stream) {
      return
    }
    for (const streamId of stream.streamIds) {
      this.terminalListeners.delete(streamId)
      this.terminalSnapshots.delete(streamId)
    }
    this.clearBrowserRequest(id)
    this.streams.delete(id)
  }

  private clearBrowserRequest(id: string): void {
    if (this.activeBrowserRequestId === id) {
      this.activeBrowserRequestId = null
    }
    if (this.pendingBrowserRequestId === id) {
      this.pendingBrowserRequestId = null
    }
  }

  private fail(id: string, stream: StreamRecord, message: string, error?: unknown): void {
    if (stream.cancelled || this.streams.get(id) !== stream) {
      return
    }
    try {
      stream.listener({ type: 'error', message, error })
    } finally {
      this.remove(id)
    }
  }
}
