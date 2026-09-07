import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ListRenderItem
} from 'react-native'
import { Copy, MessageSquare, Send } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { MobileCodeScaleControls } from '../files/MobileCodeScaleControls'
import {
  scaledMobileCodeGutterWidth,
  scaledMobileCodeTextMetrics
} from '../files/mobile-code-text-scale'
import { useMobileCodeTextScale } from '../files/use-mobile-code-text-scale'
import { MobileHtmlPreview } from '../components/MobileHtmlPreview'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { colors, typography } from '../theme/mobile-theme'
import {
  buildPlainMobileDiffSyntaxLines,
  highlightMobileCode,
  highlightMobileDiffLines,
  resolveMobileSyntaxLanguage
} from './mobile-file-syntax'
import type {
  DiffCommentActions,
  DiffSyntaxState,
  FileDocState,
  FileSyntaxState,
  RenderableDiffLine
} from './mobile-session-route-types'
import { MobileSessionDiffLineRow } from './MobileSessionDiffLineRow'
import { MOBILE_SESSION_DIFF_GUTTER_WIDTH } from './mobile-session-reader-styles'
import { styles } from './mobile-session-styles'

export function MobileSessionFileReader({
  doc,
  title,
  relativePath,
  language,
  diffCommentActions
}: {
  doc: FileDocState | undefined
  title: string
  relativePath: string
  language?: string
  diffCommentActions?: DiffCommentActions
}) {
  const { textScale, panHandlers, zoomOut, zoomIn, resetZoom } = useMobileCodeTextScale()
  const codeTextMetrics = useMemo(
    () => scaledMobileCodeTextMetrics(typography.bodySize, 22, textScale),
    [textScale]
  )
  const gutterTextMetrics = useMemo(
    () => ({
      ...scaledMobileCodeTextMetrics(typography.metaSize, 22, textScale),
      width: scaledMobileCodeGutterWidth(MOBILE_SESSION_DIFF_GUTTER_WIDTH, textScale)
    }),
    [textScale]
  )
  const syntaxLanguage = useMemo(
    () => resolveMobileSyntaxLanguage(relativePath || title, language),
    [language, relativePath, title]
  )
  const [fileSyntax, setFileSyntax] = useState<FileSyntaxState | null>(null)
  const [diffSyntax, setDiffSyntax] = useState<DiffSyntaxState | null>(null)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const plainDiffLines = useMemo(
    () =>
      doc?.status === 'ready' && doc.kind === 'diff'
        ? buildPlainMobileDiffSyntaxLines(doc.lines)
        : [],
    [doc]
  )
  const diffCommentsForFile = useMemo(
    () =>
      diffCommentActions?.comments.filter(
        (comment) => comment.filePath === relativePath && comment.source !== 'markdown'
      ) ?? [],
    [diffCommentActions?.comments, relativePath]
  )
  const diffCommentsByLine = useMemo(() => {
    const map = new Map<number, DiffComment[]>()
    for (const comment of diffCommentsForFile) {
      const list = map.get(comment.lineNumber) ?? []
      list.push(comment)
      map.set(comment.lineNumber, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt)
    }
    return map
  }, [diffCommentsForFile])
  const sourceSegments = useMemo(() => {
    if (doc?.status !== 'ready' || (doc.kind !== 'file' && doc.kind !== 'html')) {
      return []
    }
    if (fileSyntax?.doc === doc && fileSyntax.language === syntaxLanguage) {
      return fileSyntax.segments
    }
    return [{ text: doc.content, kind: 'plain' as const }]
  }, [doc, fileSyntax, syntaxLanguage])

  const startComment = useCallback((lineNumber: number) => {
    setActiveCommentLine(lineNumber)
    setCommentDraft('')
  }, [])

  const cancelComment = useCallback(() => {
    setActiveCommentLine(null)
    setCommentDraft('')
  }, [])

  const submitComment = useCallback(
    (lineNumber: number) => {
      if (!diffCommentActions) {
        return
      }
      void diffCommentActions.onAdd(relativePath, lineNumber, commentDraft).then((added) => {
        if (added) {
          setActiveCommentLine(null)
          setCommentDraft('')
        }
      })
    },
    [commentDraft, diffCommentActions, relativePath]
  )

  const renderDiffLine: ListRenderItem<RenderableDiffLine> = useCallback(
    ({ item, index }) => (
      <MobileSessionDiffLineRow
        line={item}
        title={title}
        index={index}
        codeTextMetrics={codeTextMetrics}
        gutterTextMetrics={gutterTextMetrics}
        comments={
          item.newLineNumber !== undefined ? (diffCommentsByLine.get(item.newLineNumber) ?? []) : []
        }
        activeCommentLine={activeCommentLine}
        commentDraft={commentDraft}
        commentsBusy={diffCommentActions?.busy === true}
        onStartComment={startComment}
        onCancelComment={cancelComment}
        onDraftChange={setCommentDraft}
        onSubmitComment={submitComment}
        onDeleteComment={(commentId) => {
          if (diffCommentActions) {
            void diffCommentActions.onDelete(commentId)
          }
        }}
      />
    ),
    [
      activeCommentLine,
      cancelComment,
      codeTextMetrics,
      commentDraft,
      diffCommentActions,
      diffCommentsByLine,
      gutterTextMetrics,
      startComment,
      submitComment,
      title
    ]
  )

  useEffect(() => {
    if (doc?.status !== 'ready' || doc.kind === 'image') {
      setFileSyntax(null)
      setDiffSyntax(null)
      return undefined
    }
    if (doc.kind === 'diff') {
      setFileSyntax(null)
    } else {
      setDiffSyntax(null)
    }

    // Why: defer highlighting one tick so large files show as plain text immediately before colors are applied.
    const timer = setTimeout(() => {
      if (doc.kind === 'file' || doc.kind === 'html') {
        setFileSyntax({
          doc,
          language: syntaxLanguage,
          segments: highlightMobileCode(doc.content, syntaxLanguage).segments
        })
        return
      }
      if (doc.kind === 'diff') {
        setDiffSyntax({
          doc,
          language: syntaxLanguage,
          lines: highlightMobileDiffLines(doc.lines, syntaxLanguage)
        })
      }
    }, 0)

    return () => clearTimeout(timer)
  }, [doc, syntaxLanguage])

  if (!doc || doc.status === 'loading') {
    return (
      <View style={styles.markdownState}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (doc.status === 'error') {
    return (
      <View style={styles.markdownState}>
        <Text style={styles.markdownError}>{doc.message}</Text>
      </View>
    )
  }

  if (doc.kind === 'diff') {
    const activeDiffSyntax =
      diffSyntax?.doc === doc && diffSyntax.language === syntaxLanguage ? diffSyntax.lines : null
    const commentCount = diffCommentActions?.comments.length ?? 0
    const unsentCommentCount =
      diffCommentActions?.comments.filter((comment) => !comment.sentAt).length ?? 0
    const commentsBusy = diffCommentActions?.busy === true
    const canCopyNotes = commentCount > 0 && !commentsBusy
    const canSendNotes = unsentCommentCount > 0 && !commentsBusy
    return (
      <View style={styles.markdownEditor} {...panHandlers}>
        <MobileCodeScaleControls
          textScale={textScale}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onReset={resetZoom}
        />
        {diffCommentActions ? (
          <View style={styles.diffNotesToolbar}>
            <View style={styles.diffNotesTitleRow}>
              <MessageSquare size={14} color={colors.textSecondary} strokeWidth={2.2} />
              <Text style={styles.diffNotesTitle}>
                {commentCount === 0
                  ? 'No review notes'
                  : `${commentCount} review ${commentCount === 1 ? 'note' : 'notes'}`}
              </Text>
            </View>
            <View style={styles.diffNotesActions}>
              <Pressable
                style={[
                  styles.diffNotesActionButton,
                  !canCopyNotes && styles.diffCommentButtonDisabled
                ]}
                disabled={!canCopyNotes}
                onPress={() => void diffCommentActions.onCopyAll()}
                accessibilityLabel="Copy review notes"
              >
                <Copy size={13} color={colors.textSecondary} strokeWidth={2.2} />
                <Text style={styles.diffNotesActionText}>Copy</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.diffNotesActionButton,
                  !canSendNotes && styles.diffCommentButtonDisabled
                ]}
                disabled={!canSendNotes}
                onPress={diffCommentActions.onSendAll}
                accessibilityLabel="Send review notes to AI"
              >
                <Send size={13} color={colors.textSecondary} strokeWidth={2.2} />
                <Text style={styles.diffNotesActionText}>Send</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <FlatList
          data={activeDiffSyntax ?? plainDiffLines}
          style={styles.filePreviewScroll}
          contentContainerStyle={styles.filePreviewContent}
          keyExtractor={(line, index) =>
            `${index}:${line.kind}:${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}`
          }
          renderItem={renderDiffLine}
          initialNumToRender={32}
          maxToRenderPerBatch={48}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== 'web'}
          keyboardShouldPersistTaps="handled"
          extraData={textScale}
        />
      </View>
    )
  }

  if (doc.kind === 'image') {
    return (
      <View style={styles.imagePreviewContainer}>
        <ScrollView
          style={styles.imagePreviewScroll}
          contentContainerStyle={styles.imagePreviewContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
        >
          <Image
            source={{ uri: doc.dataUri }}
            style={styles.imagePreview}
            resizeMode="contain"
            accessibilityLabel={`${title} image`}
          />
        </ScrollView>
      </View>
    )
  }

  const renderSourceText = () => (
    <View style={styles.markdownEditor} {...panHandlers}>
      <MobileCodeScaleControls
        textScale={textScale}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={resetZoom}
      />
      <ScrollView
        style={styles.filePreviewScroll}
        contentContainerStyle={styles.filePreviewContent}
      >
        <Text
          selectable
          style={[styles.filePreviewText, codeTextMetrics]}
          accessibilityLabel={`${title} preview`}
        >
          <MobileSyntaxSegments segments={sourceSegments} />
        </Text>
      </ScrollView>
    </View>
  )

  if (doc.kind === 'html') {
    return (
      <View style={styles.markdownEditor}>
        <MobileHtmlPreview html={doc.content} renderSource={renderSourceText} />
      </View>
    )
  }

  return renderSourceText()
}
