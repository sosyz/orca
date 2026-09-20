import { Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Plus, X } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { colors } from '../theme/mobile-theme'
import type { RenderableDiffLine } from './mobile-session-route-types'
import { styles } from './mobile-session-styles'

type CodeTextMetrics = { fontSize: number; lineHeight: number; width?: number }

export function MobileSessionDiffLineRow({
  active = true,
  line,
  title,
  index,
  codeTextMetrics,
  gutterTextMetrics,
  comments,
  activeCommentLine,
  commentDraft,
  commentsBusy,
  onStartComment,
  onCancelComment,
  onDraftChange,
  onSubmitComment,
  onDeleteComment
}: {
  active?: boolean
  line: RenderableDiffLine
  title: string
  index: number
  codeTextMetrics: CodeTextMetrics
  gutterTextMetrics: CodeTextMetrics
  comments: DiffComment[]
  activeCommentLine: number | null
  commentDraft: string
  commentsBusy: boolean
  onStartComment: (lineNumber: number) => void
  onCancelComment: () => void
  onDraftChange: (value: string) => void
  onSubmitComment: (lineNumber: number) => void
  onDeleteComment: (commentId: string) => void
}) {
  const { t } = useTranslation()
  const commentLine = line.newLineNumber
  const isCommenting = commentLine !== undefined && activeCommentLine === commentLine
  const canComment = active && commentLine !== undefined
  // Why: review notes anchor to the modified side, so show that line number in the single mobile gutter.
  const gutterLineNumber = line.newLineNumber ?? line.oldLineNumber ?? ''
  return (
    <View style={styles.diffLineBlock}>
      <View
        style={[
          styles.diffLine,
          line.kind === 'add' && styles.diffLineAdded,
          line.kind === 'delete' && styles.diffLineDeleted
        ]}
      >
        <Text style={[styles.diffGutter, gutterTextMetrics]}>{gutterLineNumber}</Text>
        <Text
          selectable
          style={[styles.diffText, codeTextMetrics]}
          accessibilityLabel={t('mobile.session.diff.lineLabel', '{{title}} diff line {{line}}', {
            title,
            line: index + 1
          })}
        >
          <Text
            style={[
              styles.diffPrefix,
              line.kind === 'add' && styles.diffPrefixAdded,
              line.kind === 'delete' && styles.diffPrefixDeleted
            ]}
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'delete' ? '- ' : '  '}
          </Text>
          <MobileSyntaxSegments segments={line.segments} />
        </Text>
        {canComment ? (
          <Pressable
            style={({ pressed }) => [
              styles.diffCommentAddButton,
              pressed && styles.diffCommentAddButtonPressed,
              commentsBusy && styles.diffCommentButtonDisabled
            ]}
            disabled={commentsBusy}
            onPress={() => {
              if (commentLine !== undefined) {
                onStartComment(commentLine)
              }
            }}
            accessibilityLabel={t(
              'mobile.session.reviewNotes.addLineLabel',
              'Add note on line {{line}}',
              { line: commentLine }
            )}
          >
            <Plus size={12} color={colors.textSecondary} strokeWidth={2.3} />
          </Pressable>
        ) : null}
      </View>
      {comments.length > 0 ? (
        <View style={styles.diffCommentList}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.diffCommentCard}>
              <View style={styles.diffCommentHeader}>
                <MessageSquare size={12} color={colors.textMuted} strokeWidth={2.2} />
                <Text style={styles.diffCommentMeta}>
                  {t('mobile.session.reviewNotes.lineMeta', 'Line {{line}}', {
                    line: comment.lineNumber
                  })}
                </Text>
                <Pressable
                  style={styles.diffCommentDeleteButton}
                  disabled={!active || commentsBusy}
                  onPress={() => onDeleteComment(comment.id)}
                  accessibilityLabel={t(
                    'mobile.session.reviewNotes.deleteLineLabel',
                    'Delete note on line {{line}}',
                    { line: comment.lineNumber }
                  )}
                >
                  <X size={12} color={colors.textMuted} strokeWidth={2.2} />
                </Pressable>
              </View>
              <Text style={styles.diffCommentBody}>{comment.body}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {isCommenting ? (
        <View style={styles.diffCommentComposer}>
          <TextInput
            style={[styles.textInput, styles.diffCommentInput]}
            value={commentDraft}
            onChangeText={onDraftChange}
            placeholder={t('mobile.session.reviewNotes.composerPlaceholder', 'Add review note')}
            placeholderTextColor={colors.textMuted}
            editable={active && !commentsBusy}
            multiline
            textAlignVertical="top"
            autoFocus={active}
          />
          <View style={styles.diffCommentComposerActions}>
            <Pressable
              style={styles.diffCommentSecondaryAction}
              disabled={!active || commentsBusy}
              onPress={onCancelComment}
            >
              <Text style={styles.diffCommentSecondaryText}>{t('common.cancel', 'Cancel')}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.diffCommentPrimaryAction,
                (!commentDraft.trim() || commentsBusy) && styles.diffCommentButtonDisabled
              ]}
              disabled={!active || !commentDraft.trim() || commentsBusy}
              onPress={() => {
                if (commentLine !== undefined) {
                  onSubmitComment(commentLine)
                }
              }}
            >
              <Text style={styles.diffCommentPrimaryText}>
                {t('mobile.session.reviewNotes.save', 'Save note')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}
