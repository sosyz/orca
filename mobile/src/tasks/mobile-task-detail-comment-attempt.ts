import type { RpcClient } from '../transport/rpc-client'
import type { TaskProvider } from './mobile-task-providers'

type DetailView = {
  client: RpcClient | null
  hostId: string
  itemKey: string | null
}

export type MobileTaskDetailCommentAttempt = {
  client: RpcClient
  hostId: string
  itemKey: string
  provider: TaskProvider
  generation: number
}

export type MobileTaskDetailViewSnapshot = {
  client: RpcClient
  hostId: string
  itemKey: string | null
  generation: number
}

export function createMobileTaskDetailCommentAttempts() {
  let view: DetailView | null = null
  let generation = 0

  return {
    publish(next: DetailView) {
      if (
        !view ||
        view.client !== next.client ||
        view.hostId !== next.hostId ||
        view.itemKey !== next.itemKey
      ) {
        generation += 1
      }
      view = next
    },
    invalidate() {
      view = null
      generation += 1
    },
    capture(client: RpcClient, hostId: string): MobileTaskDetailViewSnapshot | null {
      return view?.client === client && view.hostId === hostId
        ? { client, hostId, itemKey: view.itemKey, generation }
        : null
    },
    isCurrentView(snapshot: MobileTaskDetailViewSnapshot | null) {
      if (!snapshot) {
        return false
      }
      return (
        view?.client === snapshot.client &&
        view.hostId === snapshot.hostId &&
        view.itemKey === snapshot.itemKey &&
        generation === snapshot.generation
      )
    },
    begin(
      client: RpcClient,
      hostId: string,
      itemKey: string,
      provider: TaskProvider
    ): MobileTaskDetailCommentAttempt | null {
      return view?.client === client && view.hostId === hostId && view.itemKey === itemKey
        ? { client, hostId, itemKey, provider, generation }
        : null
    },
    isCurrent(attempt: MobileTaskDetailCommentAttempt) {
      return (
        view?.client === attempt.client &&
        view.hostId === attempt.hostId &&
        view.itemKey === attempt.itemKey &&
        generation === attempt.generation
      )
    }
  }
}
