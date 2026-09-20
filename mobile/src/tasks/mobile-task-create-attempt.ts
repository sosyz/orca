import type { RpcClient } from '../transport/rpc-client'
import type { TaskProvider } from './mobile-task-providers'

type CreateView = {
  client: RpcClient | null
  hostId: string
  provider: TaskProvider
  open: boolean
}

export type MobileTaskCreateAttempt = {
  client: RpcClient
  hostId: string
  provider: TaskProvider
  viewGeneration: number
  draftRevision: number
}

export function createMobileTaskCreateAttempts() {
  let view: CreateView | null = null
  let viewGeneration = 0
  let draftRevision = 0
  const pending = new Set<MobileTaskCreateAttempt>()

  return {
    publish(next: CreateView) {
      if (
        !view ||
        view.client !== next.client ||
        view.hostId !== next.hostId ||
        view.provider !== next.provider ||
        view.open !== next.open
      ) {
        viewGeneration += 1
      }
      view = next
    },
    invalidate() {
      view = null
      viewGeneration += 1
    },
    noteDraftEdit() {
      draftRevision += 1
    },
    begin(
      client: RpcClient,
      hostId: string,
      provider: TaskProvider
    ): MobileTaskCreateAttempt | null {
      if (
        view?.client !== client ||
        view.hostId !== hostId ||
        view.provider !== provider ||
        !view.open ||
        [...pending].some((attempt) => attempt.client === client && attempt.hostId === hostId)
      ) {
        return null
      }
      const attempt = { client, hostId, provider, viewGeneration, draftRevision }
      pending.add(attempt)
      return attempt
    },
    ownsDraft(attempt: MobileTaskCreateAttempt) {
      return (
        view?.client === attempt.client &&
        view.hostId === attempt.hostId &&
        view.provider === attempt.provider &&
        view.open &&
        viewGeneration === attempt.viewGeneration &&
        draftRevision === attempt.draftRevision
      )
    },
    ownsSource(attempt: MobileTaskCreateAttempt) {
      return (
        view?.client === attempt.client &&
        view.hostId === attempt.hostId &&
        view.provider === attempt.provider
      )
    },
    isBusy() {
      const current = view
      return current?.client != null
        ? [...pending].some(
            (attempt) => attempt.client === current.client && attempt.hostId === current.hostId
          )
        : false
    },
    finish(attempt: MobileTaskCreateAttempt) {
      pending.delete(attempt)
      const currentView = view
      return (
        currentView?.client === attempt.client &&
        currentView.hostId === attempt.hostId &&
        ![...pending].some(
          (current) =>
            current.client === currentView.client && current.hostId === currentView.hostId
        )
      )
    }
  }
}
