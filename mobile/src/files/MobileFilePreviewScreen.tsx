import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Save } from 'lucide-react-native'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { useMobileRouteBackHandler } from '../navigation/use-mobile-route-back-handler'
import { getWorktreeLabel } from '../session/worktree-label'
import { colors, spacing } from '../theme/mobile-theme'
import { useForceReconnect, useHostClient } from '../transport/client-context'
import {
  loadMobileFilePreview,
  previewError,
  saveMobileTerminalArtifactPreview,
  type MobileFilePreviewSource,
  type MobileFilePreviewResult
} from './mobile-file-preview-request'
import { MobileFilePreviewBody } from './MobileFilePreviewBody'
import {
  displayNameFromPreviewPath,
  type MobileFilePreviewRouteState
} from './mobile-file-preview-route'
import { previewSourceFromRoute, sourceKeyForPreview } from './mobile-file-preview-source'
import { normalizeMobileFilePreviewLineColumn } from './mobile-file-preview-line-column'
import {
  hasUnsavedMobileTerminalArtifactDraft,
  isEditableMobileTerminalArtifactPreview,
  shouldKeepDirtyDraftOnPreviewLoadResult
} from './mobile-file-preview-editability'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

type Props = {
  route: MobileFilePreviewRouteState
}

export function MobileFilePreviewScreen({ route }: Props) {
  const router = useRouter()
  const { isLandscape } = useResponsiveLayout()
  const previewParams = route.ok ? route.params : null
  const { client, state: connState } = useHostClient(previewParams?.hostId)
  const forceReconnect = useForceReconnect()
  const [preview, setPreview] = useState<MobileFilePreviewResult>(() =>
    route.ok ? { status: 'loading', message: 'Loading preview...' } : previewError(route.message)
  )
  const [draftContent, setDraftContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const draftContentRef = useRef(draftContent)
  const savedContentRef = useRef(savedContent)
  const draftSourceKeyRef = useRef<string | null>(null)
  const [previewBodySize, setPreviewBodySize] = useState({ width: 1, height: 1 })
  const routePreviewSource = useMemo(
    () => (previewParams ? previewSourceFromRoute(previewParams) : null),
    [previewParams]
  )
  const [previewSource, setPreviewSource] = useState<MobileFilePreviewSource | null>(
    routePreviewSource
  )
  const previewSourceKey = useMemo(() => sourceKeyForPreview(previewSource), [previewSource])
  const routePreviewSourceKey = useMemo(
    () => sourceKeyForPreview(routePreviewSource),
    [routePreviewSource]
  )
  const previewSourceKeyRef = useRef(previewSourceKey)
  const previewLoadRevisionRef = useRef(0)
  const lineColumn = useMemo(
    () =>
      previewParams
        ? normalizeMobileFilePreviewLineColumn(previewParams.line, previewParams.column)
        : null,
    [previewParams]
  )

  useEffect(() => {
    setPreviewSource(routePreviewSource)
    draftSourceKeyRef.current = null
  }, [routePreviewSource])

  useEffect(() => {
    previewSourceKeyRef.current = previewSourceKey
  }, [previewSourceKey])

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  useEffect(() => {
    savedContentRef.current = savedContent
  }, [savedContent])

  const loadPreview = useCallback(async () => {
    const loadRevision = ++previewLoadRevisionRef.current
    const loadSourceKey = previewSourceKey
    const isCurrentLoad = () =>
      previewLoadRevisionRef.current === loadRevision &&
      previewSourceKeyRef.current === loadSourceKey
    if (!previewParams || !previewSource || loadSourceKey !== routePreviewSourceKey) {
      setPreview(previewError(route.ok ? 'Unable to load preview' : route.message))
      return
    }
    const preserveDirtyDraft =
      draftSourceKeyRef.current === previewSourceKey &&
      draftContentRef.current !== savedContentRef.current
    if (!client || connState !== 'connected') {
      if (preserveDirtyDraft) {
        setSaveError('Waiting for desktop...')
        return
      }
      setPreview({ status: 'waiting', message: 'Waiting for desktop...', reconnect: true })
      return
    }
    if (!preserveDirtyDraft) {
      setPreview({ status: 'loading', message: 'Loading preview...' })
    }
    setSaveError('')
    try {
      const result = await loadMobileFilePreview(client, previewSource, undefined, {
        onTerminalArtifactSourceRefreshed: (source) => {
          if (isCurrentLoad()) {
            setPreviewSource(source)
          }
        },
        refreshGrant: true
      })
      if (!isCurrentLoad()) {
        return
      }
      if (shouldKeepDirtyDraftOnPreviewLoadResult(preserveDirtyDraft, result)) {
        setSaveError(result.message)
        return
      }
      const loadedContent =
        result.status === 'ready' && result.kind !== 'image'
          ? result.content
          : result.status === 'empty'
            ? ''
            : null
      if (loadedContent !== null) {
        if (!preserveDirtyDraft) {
          setDraftContent(loadedContent)
          setSavedContent(loadedContent)
        }
        draftSourceKeyRef.current = previewSourceKey
      }
      setPreview(result)
    } catch (err) {
      if (!isCurrentLoad()) {
        return
      }
      const message = err instanceof Error ? err.message : 'Unable to load preview'
      if (preserveDirtyDraft) {
        setSaveError(message)
        return
      }
      setPreview(previewError(message))
    }
  }, [
    client,
    connState,
    previewParams,
    previewSource,
    previewSourceKey,
    route,
    routePreviewSourceKey
  ])

  useEffect(() => {
    void loadPreview()
    return () => {
      // Grant refresh can start another read of the same file while this one is pending.
      previewLoadRevisionRef.current += 1
    }
  }, [loadPreview])

  const retry = useCallback(async () => {
    if (!previewParams) {
      void loadPreview()
      return
    }
    if (
      preview.status === 'waiting' ||
      (preview.status === 'error' && preview.reconnect) ||
      connState !== 'connected'
    ) {
      await forceReconnect(previewParams.hostId)
      return
    }
    void loadPreview()
  }, [connState, forceReconnect, loadPreview, preview, previewParams])

  const displayPath =
    previewParams?.source === 'terminalArtifact'
      ? (previewParams.absolutePath ?? '')
      : (previewParams?.relativePath ?? '')
  const title = previewParams?.name ?? displayNameFromPreviewPath(displayPath)
  const worktreeLabel = getWorktreeLabel(
    previewParams?.worktreeName,
    previewParams?.worktreeId ?? ''
  )
  const meta = previewParams ? `${worktreeLabel} - ${displayPath}` : 'Preview'
  const isEditableTerminalArtifact =
    previewSource?.source === 'terminalArtifact' &&
    isEditableMobileTerminalArtifactPreview(preview, previewSource.readOnly === true)
  const canSaveArtifact =
    isEditableTerminalArtifact &&
    draftSourceKeyRef.current === previewSourceKey &&
    draftContent !== savedContent
  const hasUnsavedTerminalArtifactDraft = hasUnsavedMobileTerminalArtifactDraft({
    source: previewSource?.source,
    draftSourceKey: draftSourceKeyRef.current,
    previewSourceKey,
    draftContent,
    savedContent
  })

  const saveArtifact = useCallback(async () => {
    if (
      !client ||
      previewSource?.source !== 'terminalArtifact' ||
      !canSaveArtifact ||
      savingRef.current
    ) {
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      const result = await saveMobileTerminalArtifactPreview(client, previewSource, draftContent, {
        baseContent: savedContent,
        onTerminalArtifactSourceRefreshed: setPreviewSource
      })
      if (result.status === 'saved') {
        setSavedContent(draftContent)
      } else {
        setSaveError(saveErrorMessageFromPreviewResult(result))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save file'
      setSaveError(message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [canSaveArtifact, client, draftContent, previewSource, savedContent])

  const requestBack = useCallback(() => {
    if (!hasUnsavedTerminalArtifactDraft) {
      router.back()
      return true
    }
    Alert.alert('Discard changes?', 'Unsaved edits will be lost.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() }
    ])
    return true
  }, [hasUnsavedTerminalArtifactDraft, router])

  useMobileRouteBackHandler(requestBack)

  const handlePreviewBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setPreviewBodySize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    )
  }, [])

  return (
    <SafeAreaView
      style={styles.container}
      edges={isLandscape ? ['left', 'right', 'bottom'] : ['bottom']}
    >
      <SafeAreaView style={styles.header} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={requestBack}
            hitSlop={8}
            accessibilityLabel="Back to files"
          >
            <ChevronLeft size={22} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title || 'Preview'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {isEditableTerminalArtifact ? (
            <Pressable
              style={[styles.saveButton, (!canSaveArtifact || saving) && styles.saveButtonDisabled]}
              onPress={() => void saveArtifact()}
              disabled={!canSaveArtifact || saving}
              accessibilityLabel="Save terminal artifact"
            >
              <Save size={18} color={colors.textPrimary} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
      <View style={styles.body} onLayout={handlePreviewBodyLayout}>
        <MobileFilePreviewBody
          preview={preview}
          relativePath={displayPath}
          title={title || 'File'}
          editable={isEditableTerminalArtifact}
          draftContent={draftContent}
          saveError={saveError}
          lineColumn={lineColumn}
          imageWidth={Math.max(1, previewBodySize.width - spacing.md * 2)}
          imageHeight={Math.max(1, previewBodySize.height - spacing.md * 2)}
          onDraftChange={setDraftContent}
          onImageError={() =>
            setPreview({ status: 'error', message: 'Unable to load preview', reconnect: false })
          }
          onRetry={retry}
        />
      </View>
    </SafeAreaView>
  )
}

function saveErrorMessageFromPreviewResult(result: MobileFilePreviewResult): string {
  return result.status === 'error' || result.status === 'waiting'
    ? result.message
    : 'Unable to save file'
}
