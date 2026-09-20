import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { findMobileNativeChatEvictionCandidate } from './mobile-native-chat-runtime-eviction-priority'
import type { UnconfirmedSend } from './mobile-native-chat-draft-reconcile'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import {
  applyLandedImagePreviewDataUriBudget,
  MOBILE_NATIVE_CHAT_LANDED_PREVIEW_CHAR_BUDGET
} from './mobile-native-chat-landed-preview-budget'
import type {
  MobileNativeChatPendingMessage,
  MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'

const MOBILE_NATIVE_CHAT_RUNTIME_SCOPE_CAP = 32

export type MobileNativeChatRuntimeScopeToken = {
  readonly scopeKey: string
  readonly generation: number
}

export type MobileNativeChatLaunchDraftSeed = {
  text: string
  createdAt: number | null
}

export type MobileNativeChatStoredUnconfirmedSend = UnconfirmedSend & {
  readonly id: string
  readonly sourceId: string
  readonly pendingKey: string | null
  readonly message: string
  readonly deadlineAt: number
  deadline: ReturnType<typeof setTimeout> | null
  baselineResolved: boolean
  timedOut: boolean
}

export type MobileNativeChatSendErrorRecord = {
  readonly id: string
  readonly message: string
  readonly sourceId: string | null
  timer: ReturnType<typeof setTimeout> | null
}

export type MobileNativeChatRuntimeScope = {
  generation: number
  revision: number
  unconfirmedRevision: number
  activeCount: number
  draftText: string
  draftEditGeneration: number
  pendingBySession: Record<string, MobileNativeChatPendingMessage[]>
  pendingWaitingForSession: MobileNativeChatPendingMessage[]
  imagePreviewsBySession: Record<string, Record<string, string[]>>
  pendingCounter: number
  attachments: PendingNativeChatImage[]
  attachingCount: number
  launchDraftSeedRecorded: boolean
  launchDraftSeed: MobileNativeChatLaunchDraftSeed | null
  unconfirmedSends: MobileNativeChatStoredUnconfirmedSend[]
  unconfirmedReservations: Map<string, Set<number>>
  unconfirmedCounter: number
  sendError: MobileNativeChatSendErrorRecord | null
  sendErrorCounter: number
}

type ScopeListener = () => void

const scopes = new Map<string, MobileNativeChatRuntimeScope>()
const listenersByScope = new Map<string, Set<ScopeListener>>()
const attachmentCounter = { current: 0 }
let generationCounter = 0
let revisionCounter = 0
let unconfirmedRevisionCounter = 0
let capEnforcementQueued = false
let capEnforcementGeneration = 0

function createScope(): MobileNativeChatRuntimeScope {
  return {
    generation: ++generationCounter,
    revision: ++revisionCounter,
    unconfirmedRevision: ++unconfirmedRevisionCounter,
    activeCount: 0,
    draftText: '',
    draftEditGeneration: 0,
    pendingBySession: {},
    pendingWaitingForSession: [],
    imagePreviewsBySession: {},
    pendingCounter: 0,
    attachments: [],
    attachingCount: 0,
    launchDraftSeedRecorded: false,
    launchDraftSeed: null,
    unconfirmedSends: [],
    unconfirmedReservations: new Map(),
    unconfirmedCounter: 0,
    sendError: null,
    sendErrorCounter: 0
  }
}

function notifyScope(scopeKey: string): void {
  for (const listener of listenersByScope.get(scopeKey) ?? []) {
    listener()
  }
}

function disposeScope(scope: MobileNativeChatRuntimeScope): void {
  for (const entry of scope.unconfirmedSends) {
    clearTimeout(entry.deadline ?? undefined)
    entry.deadline = null
  }
  if (scope.sendError?.timer) {
    clearTimeout(scope.sendError.timer)
    scope.sendError.timer = null
  }
}

function subscribeToScope(scopeKey: string | null, onChange: ScopeListener): () => void {
  if (!scopeKey) {
    return () => {}
  }
  let listeners = listenersByScope.get(scopeKey)
  if (!listeners) {
    listeners = new Set()
    listenersByScope.set(scopeKey, listeners)
  }
  listeners.add(onChange)
  return () => {
    listeners?.delete(onChange)
    if (listeners?.size === 0) {
      listenersByScope.delete(scopeKey)
    }
  }
}

function evictOneInactiveScope(protectedScopeKey?: string): boolean {
  const scopeKey = findMobileNativeChatEvictionCandidate(scopes, protectedScopeKey)
  if (scopeKey === null) {
    return false
  }
  purgeMobileNativeChatRuntimeScope(scopeKey)
  return true
}

function enforceScopeCap(protectedScopeKey?: string): void {
  while (scopes.size > MOBILE_NATIVE_CHAT_RUNTIME_SCOPE_CAP) {
    if (!evictOneInactiveScope(protectedScopeKey)) {
      return
    }
  }
}

function scheduleScopeCapEnforcement(): void {
  if (capEnforcementQueued || scopes.size <= MOBILE_NATIVE_CHAT_RUNTIME_SCOPE_CAP) {
    return
  }
  capEnforcementQueued = true
  const scheduledGeneration = capEnforcementGeneration
  void Promise.resolve().then(() => {
    if (scheduledGeneration !== capEnforcementGeneration) {
      return
    }
    capEnforcementQueued = false
    enforceScopeCap()
  })
}

export function ensureMobileNativeChatRuntimeScope(scopeKey: string): MobileNativeChatRuntimeScope {
  let scope = scopes.get(scopeKey)
  if (!scope) {
    scope = createScope()
    scopes.set(scopeKey, scope)
  } else {
    scopes.delete(scopeKey)
    scopes.set(scopeKey, scope)
  }
  return scope
}

function touchMobileNativeChatRuntimeScope(scopeKey: string): void {
  const scope = scopes.get(scopeKey)
  if (!scope) {
    return
  }
  scopes.delete(scopeKey)
  scopes.set(scopeKey, scope)
}

export function getMobileNativeChatRuntimeScope(
  scopeKey: string | null
): MobileNativeChatRuntimeScope | null {
  return scopeKey ? (scopes.get(scopeKey) ?? null) : null
}

export function getMobileNativeChatRuntimeScopeForToken(
  token: MobileNativeChatRuntimeScopeToken | null
): MobileNativeChatRuntimeScope | null {
  const scope = token ? scopes.get(token.scopeKey) : null
  return scope && token && scope.generation === token.generation ? scope : null
}

export function mobileNativeChatRuntimeTokenFromOrigin(
  origin: MobileNativeChatSendOrigin
): MobileNativeChatRuntimeScopeToken {
  return { scopeKey: origin.draftKey, generation: origin.scopeGeneration }
}

export function publishMobileNativeChatRuntimeScope(
  scopeKey: string,
  signal?: 'unconfirmed'
): void {
  const scope = scopes.get(scopeKey)
  if (scope) {
    scope.revision = ++revisionCounter
    if (signal === 'unconfirmed') {
      scope.unconfirmedRevision = ++unconfirmedRevisionCounter
    }
  }
  notifyScope(scopeKey)
}

export function getMobileNativeChatRuntimeAttachmentCounter(): { current: number } {
  return attachmentCounter
}

export function writeMobileNativeChatRuntimeScope(
  token: MobileNativeChatRuntimeScopeToken | null,
  write: (scope: MobileNativeChatRuntimeScope) => boolean,
  signal?: 'unconfirmed'
): void {
  const scope = getMobileNativeChatRuntimeScopeForToken(token)
  const previousPreviews = scope?.imagePreviewsBySession
  if (!token || !scope || !write(scope)) {
    return
  }
  touchMobileNativeChatRuntimeScope(token.scopeKey)
  if (scope.imagePreviewsBySession !== previousPreviews) {
    const changedScopes = applyLandedImagePreviewDataUriBudget(
      scopes,
      MOBILE_NATIVE_CHAT_LANDED_PREVIEW_CHAR_BUDGET
    )
    for (const scopeKey of changedScopes) {
      if (scopeKey !== token.scopeKey) {
        publishMobileNativeChatRuntimeScope(scopeKey)
      }
    }
  }
  publishMobileNativeChatRuntimeScope(token.scopeKey, signal)
  enforceScopeCap(token.scopeKey)
}

export function useMobileNativeChatRuntimeScopeRevision(scopeKey: string | null): number {
  return useSyncExternalStore(
    (onChange) => subscribeToScope(scopeKey, onChange),
    () => getMobileNativeChatRuntimeScope(scopeKey)?.revision ?? 0,
    () => 0
  )
}

export function useMobileNativeChatUnconfirmedRevision(scopeKey: string | null): number {
  return useSyncExternalStore(
    (onChange) => subscribeToScope(scopeKey, onChange),
    () => getMobileNativeChatRuntimeScope(scopeKey)?.unconfirmedRevision ?? 0,
    () => 0
  )
}

export function useMobileNativeChatRuntimeScopeToken(
  scopeKey: string | null
): MobileNativeChatRuntimeScopeToken | null {
  if (scopeKey) {
    ensureMobileNativeChatRuntimeScope(scopeKey)
  }
  useMobileNativeChatRuntimeScopeRevision(scopeKey)
  const generation = getMobileNativeChatRuntimeScope(scopeKey)?.generation ?? null
  const token = useMemo(
    () => (scopeKey && generation !== null ? { scopeKey, generation } : null),
    [generation, scopeKey]
  )
  useEffect(() => {
    const scope = getMobileNativeChatRuntimeScopeForToken(token)
    if (!token || !scope) {
      return
    }
    scope.activeCount += 1
    touchMobileNativeChatRuntimeScope(token.scopeKey)
    enforceScopeCap(token.scopeKey)
    return () => {
      const current = getMobileNativeChatRuntimeScopeForToken(token)
      if (current) {
        current.activeCount = Math.max(0, current.activeCount - 1)
        scheduleScopeCapEnforcement()
      }
    }
  }, [token])
  return token
}

export function purgeMobileNativeChatRuntimeScope(scopeKey: string | null): void {
  const scope = getMobileNativeChatRuntimeScope(scopeKey)
  if (!scopeKey || !scope) {
    return
  }
  disposeScope(scope)
  scopes.delete(scopeKey)
  notifyScope(scopeKey)
}

export function purgeMobileNativeChatRuntimeScopesForHost(hostId: string): void {
  const prefix = `${hostId}\0`
  for (const scopeKey of scopes.keys()) {
    if (scopeKey.startsWith(prefix)) {
      purgeMobileNativeChatRuntimeScope(scopeKey)
    }
  }
}

export function clearMobileNativeChatRuntimeStoreForTests(): void {
  for (const scope of scopes.values()) {
    disposeScope(scope)
  }
  scopes.clear()
  listenersByScope.clear()
  attachmentCounter.current = 0
  generationCounter = 0
  revisionCounter = 0
  unconfirmedRevisionCounter = 0
  capEnforcementQueued = false
  capEnforcementGeneration += 1
}
