export class RpcClientAuthFrameScheduler {
  private scheduled = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly socket: WebSocket,
    private readonly getCurrentSocket: () => WebSocket | null
  ) {}

  schedule(send: () => void): void {
    if (this.scheduled) {
      return
    }
    this.scheduled = true
    // Why: RNOH may dispatch e2ee_ready before the hello send returns and drops a nested send.
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.getCurrentSocket() === this.socket && this.socket.readyState === WebSocket.OPEN) {
        send()
      }
    }, 0)
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
