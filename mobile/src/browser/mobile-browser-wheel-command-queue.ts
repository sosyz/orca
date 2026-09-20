import type { RpcClient } from '../transport/rpc-client'
import { assertRpcOk } from './mobile-browser-frame-state'
import type { BrowserPoint } from './browser-touch-geometry'

type BrowserPageParams = { worktree: string; page: string }

export type MobileBrowserWheelCommand = {
  base: BrowserPageParams
  point: BrowserPoint
  gestureId: number
  dx: number
  dy: number
}

type PendingMobileBrowserWheelCommand = MobileBrowserWheelCommand & {
  scope: number
}

type MobileBrowserWheelCommandQueueOptions = {
  readClient: () => RpcClient | null
  onAccepted?: () => void
}

export class MobileBrowserWheelCommandQueue {
  private inFlightScope: number | null = null
  private pending: PendingMobileBrowserWheelCommand | null = null
  private scope = 0

  constructor(private readonly options: MobileBrowserWheelCommandQueueOptions) {}

  cancel(): void {
    this.scope += 1
    this.pending = null
  }

  enqueue(command: MobileBrowserWheelCommand): void {
    const scopedCommand = { ...command, scope: this.scope }
    this.pending = mergeWheelCommand(this.pending, scopedCommand) ?? scopedCommand
    this.flush()
  }

  private flush(): void {
    if (this.inFlightScope === this.scope) {
      return
    }
    const pending = this.pending
    const client = this.options.readClient()
    if (!pending || pending.scope !== this.scope || !client) {
      return
    }
    this.pending = null
    this.inFlightScope = pending.scope
    void this.dispatch(client, pending)
  }

  private async dispatch(
    client: RpcClient,
    command: PendingMobileBrowserWheelCommand
  ): Promise<void> {
    try {
      if (command.scope !== this.scope) {
        return
      }
      assertRpcOk(
        await client.sendRequest('browser.mouseMove', {
          ...command.base,
          x: command.point.x,
          y: command.point.y
        }),
        'Browser pointer move failed'
      )
      if (command.scope !== this.scope) {
        return
      }
      assertRpcOk(
        await client.sendRequest('browser.mouseWheel', {
          ...command.base,
          dx: command.dx,
          dy: command.dy
        }),
        'Browser scroll failed'
      )
      if (command.scope === this.scope) {
        this.options.onAccepted?.()
      }
    } catch {
      // Scroll bursts commonly race page reload/navigation. Avoid replacing
      // the live browser with transient command errors like selector_not_found.
    } finally {
      if (this.inFlightScope === command.scope) {
        this.inFlightScope = null
      }
      this.flush()
    }
  }
}

function mergeWheelCommand(
  current: PendingMobileBrowserWheelCommand | null,
  next: PendingMobileBrowserWheelCommand
): PendingMobileBrowserWheelCommand | null {
  if (
    !current ||
    current.scope !== next.scope ||
    current.base.page !== next.base.page ||
    current.base.worktree !== next.base.worktree ||
    current.gestureId !== next.gestureId
  ) {
    return null
  }
  return {
    ...next,
    dx: current.dx + next.dx,
    dy: current.dy + next.dy
  }
}
