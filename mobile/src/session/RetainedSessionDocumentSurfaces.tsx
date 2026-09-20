import { useMemo, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import type {
  DiffCommentActions,
  FileDocState,
  MarkdownDocState,
  MobileSessionTab
} from './mobile-session-route-types'
import { MobileMarkdownReader } from './MobileMarkdownReader'
import { MobileSessionFileReader } from './MobileSessionFileReader'
import { RetainedSessionTabSurfaceHost } from './RetainedSessionTabSurfaceHost'

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>
type FileTab = Extract<MobileSessionTab, { type: 'file' }>
type DocumentTab = MarkdownTab | FileTab

type RetainedSessionDocumentSurfacesProps = {
  activeTab: DocumentTab | null
  fileDocs: ReadonlyMap<string, FileDocState>
  frameStyle: StyleProp<ViewStyle>
  hiddenFrameStyle: StyleProp<ViewStyle>
  keyboardLift: number
  markdownDocs: ReadonlyMap<string, MarkdownDocState>
  onFileRefresh: (tab: FileTab) => void
  onMarkdownChange: (tab: MarkdownTab, content: string) => void
  onMarkdownCopy: (tab: MarkdownTab) => void
  onMarkdownDiscard: (tab: MarkdownTab) => void
  onMarkdownRefresh: (tab: MarkdownTab) => void
  onMarkdownSave: (tab: MarkdownTab) => void
  resolveDiffCommentActions: (tab: FileTab) => DiffCommentActions | undefined
  tabs: readonly MobileSessionTab[]
  toast?: ReactNode
}

function isDocumentTab(tab: MobileSessionTab): tab is DocumentTab {
  return tab.type === 'markdown' || tab.type === 'file'
}

export function RetainedSessionDocumentSurfaces({
  activeTab,
  fileDocs,
  frameStyle,
  hiddenFrameStyle,
  keyboardLift,
  markdownDocs,
  onFileRefresh,
  onMarkdownChange,
  onMarkdownCopy,
  onMarkdownDiscard,
  onMarkdownRefresh,
  onMarkdownSave,
  resolveDiffCommentActions,
  tabs,
  toast
}: RetainedSessionDocumentSurfacesProps) {
  const documentTabs = useMemo(() => tabs.filter(isDocumentTab), [tabs])

  return (
    <RetainedSessionTabSurfaceHost
      activeId={activeTab?.id ?? null}
      frameStyle={frameStyle}
      hiddenFrameStyle={hiddenFrameStyle}
      surfaces={documentTabs}
      visible={activeTab != null}
      renderSurface={(tab, active) => (
        <>
          {tab.type === 'markdown' ? (
            <MobileMarkdownReader
              active={active}
              documentId={tab.id}
              doc={markdownDocs.get(tab.id)}
              keyboardLift={keyboardLift}
              onChange={(content) => onMarkdownChange(tab, content)}
              onCopy={() => onMarkdownCopy(tab)}
              onDiscard={() => onMarkdownDiscard(tab)}
              onRefresh={() => onMarkdownRefresh(tab)}
              onSave={() => onMarkdownSave(tab)}
            />
          ) : (
            <MobileSessionFileReader
              active={active}
              diffCommentActions={resolveDiffCommentActions(tab)}
              doc={fileDocs.get(tab.id)}
              language={tab.language}
              relativePath={tab.relativePath}
              title={tab.title || 'File'}
              onRefresh={() => onFileRefresh(tab)}
            />
          )}
          {active ? toast : null}
        </>
      )}
    />
  )
}
