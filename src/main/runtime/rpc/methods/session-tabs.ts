import { z } from 'zod'
import { resolveRuntimeNavigationTarget } from '../../../../shared/runtime-navigation'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod, type RpcContext } from '../core'
import {
  CreateTerminalTab,
  SessionTabsUnsubscribe,
  WorktreeTabSelector
} from './session-tabs-schemas'
import { SESSION_TAB_CLOSE_METHODS } from './session-tab-close-methods'
import {
  listSessionTabsInventory,
  projectSessionTabsForClient,
  subscribeSessionTabsInventory
} from './session-tabs-inventory'
import { SESSION_TAB_MARKDOWN_METHODS } from './session-tab-markdown-methods'
import { SESSION_TAB_MUTATION_METHODS } from './session-tab-mutation-methods'
import { restoreStructuredTabsIfSupported } from './structured-session-tab-restore'
import { assertLegacyAiVaultResumeCommandAllowed } from '../../../ai-vault/structured-session-ownership'
import type { SubscriptionRegistration } from '../../orca-runtime'

type PendingSessionTabsSubscription = {
  connectionId: string
  requestId?: string
  cancelledWorktrees: Set<string>
  worktree?: string
  registration?: SubscriptionRegistration
}

const pendingSubscriptions = new WeakMap<
  RpcContext['runtime'],
  Set<PendingSessionTabsSubscription>
>()

async function startSessionTabsSubscription(
  worktree: string,
  context: RpcContext,
  start: (initial: RuntimeMobileSessionTabsResult) => SubscriptionRegistration
): Promise<void> {
  const { runtime, connectionId, requestId, pairedDeviceId, clientCapabilities, signal } = context
  if (signal?.aborted) {
    return
  }
  const pending = pendingSubscriptions.get(runtime) ?? new Set<PendingSessionTabsSubscription>()
  const setup: PendingSessionTabsSubscription = {
    connectionId: connectionId ?? 'local',
    requestId,
    cancelledWorktrees: new Set<string>()
  }
  pendingSubscriptions.set(runtime, pending)
  pending.add(setup)
  try {
    await restoreStructuredTabsIfSupported(runtime, clientCapabilities)
    if (signal?.aborted) {
      return
    }
    const initial = await runtime.listMobileSessionTabs(worktree, pairedDeviceId)
    if (!signal?.aborted && !setup.cancelledWorktrees.has(initial.worktree)) {
      setup.worktree = initial.worktree
      setup.registration = start(initial)
    }
  } finally {
    pending.delete(setup)
    if (pending.size === 0) {
      pendingSubscriptions.delete(runtime)
    }
  }
}

export const SESSION_TAB_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'session.tabs.list',
    params: WorktreeTabSelector,
    handler: async (params, { runtime, pairedDeviceId, clientKind, clientCapabilities }) => {
      await restoreStructuredTabsIfSupported(runtime, clientCapabilities)
      return projectSessionTabsForClient(
        await runtime.listMobileSessionTabs(params.worktree, pairedDeviceId),
        clientKind,
        clientCapabilities
      )
    }
  }),
  defineMethod({
    name: 'session.tabs.listAll',
    params: null,
    handler: async (_params, context) => {
      await restoreStructuredTabsIfSupported(context.runtime, context.clientCapabilities)
      return listSessionTabsInventory(context)
    }
  }),
  ...SESSION_TAB_MUTATION_METHODS,
  ...SESSION_TAB_CLOSE_METHODS,
  defineMethod({
    name: 'session.tabs.createTerminal',
    params: CreateTerminalTab,
    handler: async (params, { runtime, signal, clientKind, pairedDeviceId }) => {
      if (params.command) {
        await assertLegacyAiVaultResumeCommandAllowed(params.command, () =>
          runtime.ensureStructuredAgentSessionHost()
        )
      }
      return runtime.createMobileSessionTerminal(params.worktree, {
        afterTabId: params.afterTabId,
        targetGroupId: params.targetGroupId,
        command: params.command,
        cwd: params.cwd,
        ...(params.env ? { env: params.env } : {}),
        ...(params.envToDelete ? { envToDelete: params.envToDelete } : {}),
        startupCommandDelivery: params.startupCommandDelivery,
        agent: params.agent,
        ...(params.agentPrompt !== undefined ? { agentPrompt: params.agentPrompt } : {}),
        ...(params.launchConfig ? { launchConfig: params.launchConfig } : {}),
        ...(params.launchToken ? { launchToken: params.launchToken } : {}),
        ...(params.launchAgent ? { launchAgent: params.launchAgent } : {}),
        ...(params.viewMode ? { viewMode: params.viewMode } : {}),
        activate: params.activate,
        select: params.select,
        clientNavigationId: pairedDeviceId,
        navigation: resolveRuntimeNavigationTarget({
          navigation: params.navigation,
          clientKind
        }),
        clientMutationId: params.clientMutationId,
        // Why: a dead client connection must cancel the surface wait instead
        // of running down the timeout and rolling back a live tab (#7718).
        signal
      })
    }
  }),
  defineStreamingMethod({
    name: 'session.tabs.subscribe',
    params: WorktreeTabSelector,
    handler: async (params, context, emit) => {
      const { runtime, connectionId, requestId, pairedDeviceId, clientKind, clientCapabilities } =
        context
      await startSessionTabsSubscription(params.worktree, context, (initial) => {
        const subscribedWorktree = initial.worktree
        let unsubscribe = (): void => {}
        let closed = false
        let initialized = false
        const cleanupPrefix = `session.tabs:${connectionId ?? 'local'}:${subscribedWorktree}`
        const subscriptionId = requestId ? `${cleanupPrefix}:${requestId}` : cleanupPrefix
        // Why: shared-control can carry multiple subscribers for one worktree on
        // one socket; include the RPC id so one subscriber cannot evict another.
        const registration = runtime.registerOwnedSubscriptionCleanup(
          subscriptionId,
          () => {
            closed = true
            unsubscribe()
            if (initialized) {
              emit({ type: 'end' })
            }
          },
          connectionId
        )
        if (closed) {
          return registration
        }
        emit({
          type: 'snapshot',
          ...projectSessionTabsForClient(initial, clientKind, clientCapabilities)
        })
        initialized = true
        if (closed) {
          return registration
        }

        unsubscribe = runtime.onMobileSessionTabsChanged((snapshot) => {
          if (snapshot.worktree === subscribedWorktree) {
            emit({
              type: 'updated',
              ...projectSessionTabsForClient(snapshot, clientKind, clientCapabilities)
            })
          }
        }, pairedDeviceId)
        if (closed) {
          unsubscribe()
        }
        return registration
      })
    }
  }),
  defineMethod({
    name: 'session.tabs.unsubscribe',
    params: SessionTabsUnsubscribe,
    handler: async (params, { runtime, connectionId, pairedDeviceId }) => {
      const pending = [...(pendingSubscriptions.get(runtime) ?? [])]
      const connection = connectionId ?? 'local'
      const captured = runtime.captureSubscriptionCleanups(`session.tabs:${connection}:`)
      const snapshot = await runtime.listMobileSessionTabs(params.worktree, pairedDeviceId)
      // Setup has no resolved cleanup key yet; fence only pending requests on this connection.
      for (const setup of pending) {
        if (
          setup.connectionId === connection &&
          (!params.subscriptionId || setup.requestId === params.subscriptionId)
        ) {
          setup.cancelledWorktrees.add(snapshot.worktree)
          if (setup.worktree === snapshot.worktree) {
            setup.registration?.releaseIfCurrent()
          }
        }
      }
      if (params.subscriptionId) {
        captured
          .get(`session.tabs:${connection}:${snapshot.worktree}:${params.subscriptionId}`)
          ?.releaseIfCurrent()
        return { unsubscribed: true }
      }
      const rawId = `session.tabs:${connection}:${params.worktree}`
      const resolvedId = `session.tabs:${connection}:${snapshot.worktree}`
      for (const [id, registration] of captured) {
        if (id === rawId || id === resolvedId || id.startsWith(`${resolvedId}:`)) {
          registration.releaseIfCurrent()
        }
      }
      return { unsubscribed: true }
    }
  }),
  defineStreamingMethod({
    name: 'session.tabs.subscribeAll',
    params: null,
    handler: async (_params, context, emit) => {
      await restoreStructuredTabsIfSupported(context.runtime, context.clientCapabilities)
      return subscribeSessionTabsInventory(context, emit)
    }
  }),
  defineMethod({
    name: 'session.tabs.unsubscribeAll',
    params: z
      .object({
        subscriptionId: z.string().min(1).optional()
      })
      .nullish(),
    handler: async (params, { runtime, connectionId }) => {
      const cleanupPrefix = `session.tabs:${connectionId ?? 'local'}:*`
      if (params?.subscriptionId) {
        runtime.cleanupSubscription(`${cleanupPrefix}:${params.subscriptionId}`)
        return { unsubscribed: true }
      }
      runtime.cleanupSubscription(cleanupPrefix)
      runtime.cleanupSubscriptionsByPrefix(`${cleanupPrefix}:`)
      return { unsubscribed: true }
    }
  }),
  ...SESSION_TAB_MARKDOWN_METHODS
]
