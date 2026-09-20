import type {
  DirtyMarkdownDraft,
  MarkdownDocState,
  MobileSessionTab
} from './mobile-session-route-types'

export function collectDirtyMobileMarkdownDrafts(
  docs: ReadonlyMap<string, MarkdownDocState>,
  tabs: readonly MobileSessionTab[]
): DirtyMarkdownDraft[] {
  const titles = new Map(tabs.map((tab) => [tab.id, tab.title]))
  const drafts: DirtyMarkdownDraft[] = []
  for (const [tabId, doc] of docs) {
    if (doc.status === 'ready' && doc.isDirty) {
      drafts.push({ tabId, title: titles.get(tabId) || 'Markdown', content: doc.localContent })
    }
  }
  return drafts
}

export async function copyMobileMarkdownDraftsBeforeLeave({
  isCurrent,
  getDrafts,
  copy,
  leave,
  onChanged,
  onError
}: {
  isCurrent: () => boolean
  getDrafts: () => DirtyMarkdownDraft[]
  copy: (text: string) => Promise<void>
  leave: () => void
  onChanged: (drafts: DirtyMarkdownDraft[]) => void
  onError: () => void
}): Promise<void> {
  if (!isCurrent()) {
    return
  }
  const drafts = getDrafts().map((draft) => ({ ...draft }))
  if (drafts.length === 0) {
    leave()
    return
  }
  try {
    await copy(drafts.map((draft) => `# ${draft.title}\n\n${draft.content}`).join('\n\n---\n\n'))
  } catch {
    if (isCurrent()) {
      onError()
    }
    return
  }
  if (!isCurrent()) {
    return
  }
  const copied = new Map(drafts.map((draft) => [draft.tabId, draft.content]))
  const currentDrafts = getDrafts()
  // A clipboard receipt protects only the exact drafts it copied.
  if (currentDrafts.some((draft) => copied.get(draft.tabId) !== draft.content)) {
    onChanged(currentDrafts)
    return
  }
  leave()
}
