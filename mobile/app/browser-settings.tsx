import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import {
  loadTerminalLinkOpenMode,
  saveTerminalLinkOpenMode,
  type MobileTerminalLinkOpenMode
} from '../src/storage/preferences'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

const LINK_MODE_OPTION_DEFINITIONS: readonly {
  value: MobileTerminalLinkOpenMode
  labelKey: string
  labelFallback: string
  subtitleKey: string
  subtitleFallback: string
}[] = [
  {
    value: 'orca-browser',
    labelKey: 'mobile.settings.browserSettings.links.options.orcaBrowser.label',
    labelFallback: 'Orca browser on desktop',
    subtitleKey: 'mobile.settings.browserSettings.links.options.orcaBrowser.subtitle',
    subtitleFallback: 'Open in the streamed browser from your paired desktop.'
  },
  {
    value: 'phone-browser',
    labelKey: 'mobile.settings.browserSettings.links.options.phoneBrowser.label',
    labelFallback: 'Phone browser',
    subtitleKey: 'mobile.settings.browserSettings.links.options.phoneBrowser.subtitle',
    subtitleFallback: 'Open in Safari, Chrome, or another browser on this phone.'
  }
]

function linkModeLabel(
  mode: MobileTerminalLinkOpenMode,
  options: readonly PickerOption<MobileTerminalLinkOpenMode>[]
): string {
  return options.find((option) => option.value === mode)?.label ?? options[0]!.label
}

export default function BrowserSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [linkMode, setLinkMode] = useState<MobileTerminalLinkOpenMode>('orca-browser')
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectionRevisionRef = useRef(0)
  const linkModeOptions = LINK_MODE_OPTION_DEFINITIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey, option.labelFallback),
    subtitle: t(option.subtitleKey, option.subtitleFallback)
  }))

  useEffect(() => {
    let cancelled = false
    const revision = selectionRevisionRef.current
    void loadTerminalLinkOpenMode().then((mode) => {
      if (!cancelled && selectionRevisionRef.current === revision) {
        setLinkMode(mode)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const selectLinkMode = useCallback((mode: MobileTerminalLinkOpenMode) => {
    selectionRevisionRef.current += 1
    setLinkMode(mode)
    void saveTerminalLinkOpenMode(mode)
  }, [])

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>{t('mobile.settings.browser', 'Browser')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.groupHeading}>
          {t('mobile.settings.browserSettings.links.heading', 'LINKS')}
        </Text>
        <Text style={styles.groupDescription}>
          {t(
            'mobile.settings.browserSettings.links.description',
            'Choose where HTTP(S) links tapped in terminal output open.'
          )}
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setPickerOpen(true)}
          >
            <Globe size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {t('mobile.settings.browserSettings.links.rowLabel', 'Open terminal links')}
              </Text>
              <Text style={styles.rowSublabel}>{linkModeLabel(linkMode, linkModeOptions)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>

      <PickerModal<MobileTerminalLinkOpenMode>
        visible={pickerOpen}
        title={t('mobile.settings.browserSettings.links.pickerTitle', 'Open terminal links')}
        options={linkModeOptions}
        selected={linkMode}
        onSelect={selectLinkMode}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg,
    paddingTop: 0
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  scrollContent: {
    paddingBottom: spacing.xl
  },
  groupHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  groupDescription: {
    fontSize: typography.bodySize - 1,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  sectionTopGap: {
    marginTop: spacing.sm
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowContent: {
    flex: 1
  },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  }
})
