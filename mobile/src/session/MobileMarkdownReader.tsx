import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Keyboard as KeyboardIcon, RefreshCw } from 'lucide-react-native'
import {
  MobileRichMarkdownEditor,
  type MobileRichMarkdownEditorHandle
} from '../components/MobileRichMarkdownEditor'
import { colors, spacing } from '../theme/mobile-theme'
import {
  resolveMarkdownFloatingActionsBottom,
  shouldShowMarkdownFloatingActions
} from './markdown-floating-actions-layout'
import type { MarkdownDocState } from './mobile-session-route-types'
import { styles } from './mobile-session-styles'

type Props = {
  active?: boolean
  documentId: string
  doc: MarkdownDocState | undefined
  onRefresh: () => void
  onChange: (content: string) => void
  onSave: () => void
  onCopy: () => void
  onDiscard: () => void
  keyboardLift: number
}

export function MobileMarkdownReader({
  active = true,
  documentId,
  doc,
  onRefresh,
  onChange,
  onSave,
  onCopy,
  onDiscard,
  keyboardLift
}: Props) {
  const { t } = useTranslation()
  const editorRef = useRef<MobileRichMarkdownEditorHandle>(null)
  // Native Keyboard events under-report the WebView editor's covered area, so prefer the larger WebView-measured inset.
  const [webviewKeyboardState, setWebviewKeyboardState] = useState({ active, inset: 0 })
  if (webviewKeyboardState.active !== active) {
    setWebviewKeyboardState({ active, inset: 0 })
  }
  const webviewKeyboardInset =
    webviewKeyboardState.active === active ? webviewKeyboardState.inset : 0
  const effectiveKeyboardLift = active ? Math.max(keyboardLift, webviewKeyboardInset) : 0
  const keyboardOpen = effectiveKeyboardLift > 0

  useEffect(() => {
    if (!active) {
      editorRef.current?.dismissKeyboard()
    }
  }, [active])

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
        <Pressable style={styles.markdownRefreshButton} onPress={onRefresh}>
          <RefreshCw size={14} color={colors.textPrimary} />
          <Text style={styles.markdownRefreshText}>{t('common.retry', 'Retry')}</Text>
        </Pressable>
      </View>
    )
  }

  const statusText = doc.saveError
    ? doc.saveError
    : doc.refreshError
      ? doc.refreshError
      : doc.readOnlyReason
        ? t('mobile.session.markdown.readOnly', 'Read only')
        : doc.stale
          ? t('mobile.session.markdown.changedOnDesktop', 'Changed on desktop')
          : null
  const showRefresh = Boolean(doc.refreshError || (doc.stale && !doc.isDirty) || !doc.editable)
  const showCopy = Boolean(doc.saveError || !doc.editable)
  const showSave = Boolean(doc.isDirty || doc.saving)
  const showFloatingActions =
    active &&
    shouldShowMarkdownFloatingActions({
      keyboardLift: effectiveKeyboardLift,
      hasStatus: statusText != null,
      showRefresh,
      showCopy,
      showSave
    })

  return (
    <View style={styles.markdownEditor}>
      <MobileRichMarkdownEditor
        ref={editorRef}
        key={documentId}
        content={doc.localContent}
        editable={active && doc.editable && !doc.saving}
        onChange={onChange}
        onKeyboardInsetChange={(inset) => setWebviewKeyboardState({ active, inset })}
      />
      {showFloatingActions ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.markdownFloatingBar,
            // Why: editor focus lives in a WebView, so lift native Save/Discard controls instead of resizing it.
            {
              bottom: resolveMarkdownFloatingActionsBottom({
                keyboardLift: effectiveKeyboardLift,
                restingBottom: spacing.lg,
                liftedClearance: spacing.md
              })
            }
          ]}
        >
          {statusText ? (
            <Text
              style={[
                styles.markdownFloatingStatus,
                doc.saveError || doc.refreshError ? styles.markdownError : null
              ]}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          ) : null}
          <View style={styles.markdownFloatingActions}>
            {keyboardOpen ? (
              <Pressable
                style={[styles.markdownFloatingButton, styles.markdownKeyboardDismissButton]}
                onPress={() => editorRef.current?.dismissKeyboard()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t(
                  'mobile.session.markdown.dismissKeyboard.label',
                  'Dismiss keyboard'
                )}
                accessibilityHint={t(
                  'mobile.session.markdown.dismissKeyboard.hint',
                  'Hides the software keyboard and keeps the markdown editor open.'
                )}
              >
                <View style={styles.keyboardDismissGlyph}>
                  <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
                  <ChevronDown
                    size={10}
                    color={colors.textSecondary}
                    strokeWidth={2.5}
                    style={styles.keyboardDismissChevron}
                  />
                </View>
              </Pressable>
            ) : null}
            {showCopy ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onCopy}>
                <Text style={styles.markdownFloatingButtonText}>
                  {t('mobile.session.markdown.actions.copy', 'Copy')}
                </Text>
              </Pressable>
            ) : null}
            {showRefresh ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onRefresh}>
                <RefreshCw size={13} color={colors.textPrimary} />
                <Text style={styles.markdownFloatingButtonText}>
                  {t('mobile.session.markdown.actions.refresh', 'Refresh')}
                </Text>
              </Pressable>
            ) : null}
            {doc.isDirty ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onDiscard}>
                <Text style={styles.markdownFloatingButtonText}>
                  {t('mobile.session.markdown.actions.discard', 'Discard')}
                </Text>
              </Pressable>
            ) : null}
            {showSave ? (
              <Pressable
                style={[
                  styles.markdownFloatingButton,
                  styles.markdownSaveButton,
                  (!doc.editable || !doc.isDirty || doc.saving) && styles.markdownButtonDisabled
                ]}
                disabled={!doc.editable || !doc.isDirty || doc.saving}
                onPress={onSave}
              >
                {doc.saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.markdownFloatingButtonText}>{t('common.save', 'Save')}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}
