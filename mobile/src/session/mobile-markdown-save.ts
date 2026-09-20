import type { RpcClient } from '../transport/rpc-client'
import type { MarkdownDocState } from './mobile-session-route-types'

export type MarkdownSaveRequest = { pending: boolean; awaitingCommit?: boolean }

const SAVE_COMMIT = Symbol('markdown-save-commit')
type ReadyMarkdownDoc = Extract<MarkdownDocState, { status: 'ready' }>
type CommittedMarkdownDoc = ReadyMarkdownDoc & { [SAVE_COMMIT]?: MarkdownSaveRequest }

type MarkdownSaveResult = {
  content: string
  version: string
}

type SaveMarkdownDocumentOptions = {
  client: Pick<RpcClient, 'sendRequest'>
  current: MarkdownDocState | undefined
  tabId: string
  worktreeId: string
  requests: Map<string, MarkdownSaveRequest>
  isCurrentScope: () => boolean
  invalidateReads: () => void
  updateDocs: (
    update: (prev: Map<string, MarkdownDocState>) => Map<string, MarkdownDocState>
  ) => void
  onSaved: () => void
  onError: () => void
}

export function acknowledgeMobileMarkdownSaveCommits(
  requests: Map<string, MarkdownSaveRequest>,
  docs: Map<string, MarkdownDocState>
): void {
  for (const [tabId, request] of requests) {
    const doc = docs.get(tabId)
    if (
      request.awaitingCommit &&
      doc?.status === 'ready' &&
      (doc as CommittedMarkdownDoc)[SAVE_COMMIT] === request
    ) {
      request.awaitingCommit = false
      request.pending = false
    }
  }
}

export async function saveMobileMarkdownDocument({
  client,
  current,
  tabId,
  worktreeId,
  requests,
  isCurrentScope,
  invalidateReads,
  updateDocs,
  onSaved,
  onError
}: SaveMarkdownDocumentOptions): Promise<void> {
  if (
    current?.status !== 'ready' ||
    current.saving ||
    !current.editable ||
    requests.get(tabId)?.pending ||
    !isCurrentScope()
  ) {
    return
  }
  const request: MarkdownSaveRequest = { pending: true }
  requests.set(tabId, request)
  const isCurrent = () => requests.get(tabId) === request && isCurrentScope()
  const updateCurrent = (update: (doc: ReadyMarkdownDoc) => MarkdownDocState) => {
    updateDocs((prev) => {
      const doc = prev.get(tabId)
      return isCurrent() && doc?.status === 'ready' ? new Map(prev).set(tabId, update(doc)) : prev
    })
  }

  invalidateReads()
  updateCurrent((doc) => ({ ...doc, saving: true, refreshing: false, saveError: undefined }))
  try {
    const response = await client.sendRequest('markdown.saveTab', {
      worktree: `id:${worktreeId}`,
      tabId,
      baseVersion: current.baseVersion,
      content: current.localContent
    })
    if (!isCurrent()) {
      return
    }
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    const result = response.result as MarkdownSaveResult
    invalidateReads()
    request.awaitingCommit = true
    updateCurrent((doc) => {
      const localContent =
        doc.localContent === current.localContent ? result.content : doc.localContent
      return {
        ...doc,
        content: result.content,
        localContent,
        baseVersion: result.version,
        isDirty: localContent !== result.content,
        saving: false,
        stale: false,
        refreshing: false,
        refreshError: undefined,
        saveError: undefined,
        [SAVE_COMMIT]: request
      }
    })
    onSaved()
  } catch (error) {
    if (!isCurrent()) {
      return
    }
    const message = error instanceof Error ? error.message : 'Save failed'
    request.awaitingCommit = true
    updateCurrent((doc) => ({
      ...doc,
      saving: false,
      saveError: message || 'Save failed',
      [SAVE_COMMIT]: request
    }))
    onError()
  } finally {
    if (!request.awaitingCommit) {
      request.pending = false
    }
  }
}
