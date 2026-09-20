import { buildMarkdownDiskFallbackDoc } from './mobile-markdown-disk-fallback'
import type { FileDocState, MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

type MarkdownReadResult = {
  content: string
  version: string
  isDirty: boolean
  editable?: boolean
  readOnlyReason?: string
}

type MarkdownDiskFallbackResult = {
  content: string
  truncated: boolean
}

export type MobileSessionDocumentReadToken = object

type DocumentReadRequestRefs = {
  markdown: Map<string, MobileSessionDocumentReadToken>
  file: Map<string, MobileSessionDocumentReadToken>
}

export type MobileSessionDocumentReadRequest = {
  tabId: string
  token: MobileSessionDocumentReadToken
  type: 'markdown' | 'file'
}

function updateMapEntry<T>(
  prev: ReadonlyMap<string, T>,
  id: string,
  value: T | null
): Map<string, T> {
  const next = new Map(prev)
  if (value === null) {
    next.delete(id)
  } else {
    next.set(id, value)
  }
  return next
}

function activeReadMap(
  refs: DocumentReadRequestRefs,
  type: MobileSessionDocumentReadRequest['type']
): Map<string, MobileSessionDocumentReadToken> {
  return type === 'markdown' ? refs.markdown : refs.file
}

export function reserveMobileSessionDocumentRead(
  refs: DocumentReadRequestRefs,
  type: MobileSessionDocumentReadRequest['type'],
  tabId: string
): MobileSessionDocumentReadRequest {
  const requests = activeReadMap(refs, type)
  const token = {}
  requests.set(tabId, token)
  return { tabId, token, type }
}

export function isCurrentMobileSessionDocumentRead(
  refs: DocumentReadRequestRefs,
  request: MobileSessionDocumentReadRequest
): boolean {
  return activeReadMap(refs, request.type).get(request.tabId) === request.token
}

export function clearMobileSessionDocumentRead(refs: DocumentReadRequestRefs, tabId: string): void {
  refs.markdown.delete(tabId)
  refs.file.delete(tabId)
}

export function deleteMobileSessionDocumentState<T>(
  prev: Map<string, T>,
  tabId: string
): Map<string, T> {
  if (!prev.has(tabId)) {
    return prev
  }
  return updateMapEntry(prev, tabId, null)
}

export function pruneMobileSessionDocumentReads(
  refs: DocumentReadRequestRefs,
  liveTabIds: ReadonlySet<string>
): void {
  for (const tabId of refs.markdown.keys()) {
    if (!liveTabIds.has(tabId)) {
      refs.markdown.delete(tabId)
    }
  }
  for (const tabId of refs.file.keys()) {
    if (!liveTabIds.has(tabId)) {
      refs.file.delete(tabId)
    }
  }
}

export function beginMarkdownTabRead(
  prev: ReadonlyMap<string, MarkdownDocState>,
  tabId: string
): Map<string, MarkdownDocState> {
  const current = prev.get(tabId)
  if (current?.status !== 'ready') {
    return updateMapEntry(prev, tabId, { status: 'loading' })
  }
  return updateMapEntry(prev, tabId, {
    ...current,
    refreshing: true,
    refreshError: undefined
  })
}

export function applyMarkdownTabReadSuccess(
  prev: ReadonlyMap<string, MarkdownDocState>,
  tabId: string,
  result: MarkdownReadResult,
  options?: { preserveDirty?: boolean }
): Map<string, MarkdownDocState> {
  const current = prev.get(tabId)
  if (options?.preserveDirty !== false && current?.status === 'ready' && current.isDirty) {
    const remoteChanged =
      result.isDirty || result.version !== current.baseVersion || result.content !== current.content
    return updateMapEntry(prev, tabId, {
      ...current,
      editable: result.editable === true,
      readOnlyReason: result.readOnlyReason,
      refreshError: undefined,
      refreshing: false,
      stale: current.stale || remoteChanged
    })
  }
  return updateMapEntry(prev, tabId, {
    status: 'ready',
    content: result.content,
    localContent: result.content,
    baseVersion: result.version,
    isDirty: false,
    editable: result.editable === true,
    stale: result.isDirty,
    refreshing: false,
    refreshError: undefined,
    saving: current?.status === 'ready' ? current.saving : undefined,
    saveError: current?.status === 'ready' ? current.saveError : undefined,
    readOnlyReason: result.readOnlyReason
  })
}

export function applyMarkdownDiskFallbackReadSuccess(
  prev: ReadonlyMap<string, MarkdownDocState>,
  tab: Extract<MobileSessionTab, { type: 'markdown' }>,
  result: MarkdownDiskFallbackResult,
  options?: { preserveDirty?: boolean }
): Map<string, MarkdownDocState> {
  const current = prev.get(tab.id)
  const fallback = buildMarkdownDiskFallbackDoc({
    content: result.content,
    truncated: result.truncated,
    tabIsDirty: tab.isDirty
  })
  if (options?.preserveDirty === false || current?.status !== 'ready' || !current.isDirty) {
    return updateMapEntry(prev, tab.id, fallback)
  }
  return updateMapEntry(prev, tab.id, {
    ...current,
    editable: fallback.editable,
    readOnlyReason: fallback.readOnlyReason,
    refreshError: undefined,
    refreshing: false,
    saveError: current.saveError,
    stale: current.stale || fallback.stale || fallback.content !== current.content
  })
}

export function applyMarkdownTabReadFailure(
  prev: ReadonlyMap<string, MarkdownDocState>,
  tabId: string,
  message: string
): Map<string, MarkdownDocState> {
  const current = prev.get(tabId)
  if (current?.status !== 'ready') {
    return updateMapEntry(prev, tabId, { status: 'error', message })
  }
  return updateMapEntry(prev, tabId, {
    ...current,
    refreshing: false,
    refreshError: message
  })
}

export function beginFileTabRead(
  prev: ReadonlyMap<string, FileDocState>,
  tabId: string
): Map<string, FileDocState> {
  const current = prev.get(tabId)
  if (current?.status !== 'ready') {
    return updateMapEntry(prev, tabId, { status: 'loading' })
  }
  return updateMapEntry(prev, tabId, {
    ...current,
    refreshing: true,
    refreshError: undefined
  })
}

export function applyFileTabReadSuccess(
  prev: ReadonlyMap<string, FileDocState>,
  tabId: string,
  doc: FileDocState
): Map<string, FileDocState> {
  if (doc.status !== 'ready') {
    return updateMapEntry(prev, tabId, doc)
  }
  return updateMapEntry(prev, tabId, {
    ...doc,
    refreshing: false,
    refreshError: undefined
  })
}

export function applyFileTabReadFailure(
  prev: ReadonlyMap<string, FileDocState>,
  tabId: string,
  message: string
): Map<string, FileDocState> {
  const current = prev.get(tabId)
  if (current?.status !== 'ready') {
    return updateMapEntry(prev, tabId, { status: 'error', message })
  }
  return updateMapEntry(prev, tabId, {
    ...current,
    refreshing: false,
    refreshError: message
  })
}

export function pruneMobileSessionDocumentStates<T>(
  prev: Map<string, T>,
  liveTabIds: ReadonlySet<string>
): Map<string, T> {
  let next: Map<string, T> | null = null
  for (const tabId of prev.keys()) {
    if (liveTabIds.has(tabId)) {
      continue
    }
    next ??= new Map(prev)
    next.delete(tabId)
  }
  return next ?? prev
}

export function recoverInterruptedMobileSessionDocumentStates<
  T extends MarkdownDocState | FileDocState
>(prev: Map<string, T>): Map<string, T> {
  let next: Map<string, T> | null = null
  for (const [tabId, doc] of prev) {
    if (doc.status === 'loading') {
      next ??= new Map(prev)
      next.delete(tabId)
    } else if (doc.status === 'ready' && doc.refreshing) {
      next ??= new Map(prev)
      next.set(tabId, { ...doc, refreshing: false } as T)
    }
  }
  return next ?? prev
}
