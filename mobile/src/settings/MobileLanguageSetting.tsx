import { useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { ChevronRight, Languages } from 'lucide-react-native'
import { PickerModal } from '../components/PickerModal'
import { MOBILE_LANGUAGE_OPTIONS, useMobileI18n, type MobileUiLanguage } from '../i18n'
import { colors, spacing, typography } from '../theme/mobile-theme'

export function MobileLanguageSetting() {
  const { languagePersistenceStatus, resolvedLocale, setUiLanguage, t, uiLanguage } =
    useMobileI18n()
  const [pickerVisible, setPickerVisible] = useState(false)
  const languageOptions = MOBILE_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey, option.fallback),
    subtitle:
      option.value === 'system'
        ? t('mobile.settings.language.followsDevice', 'Follows this device')
        : undefined
  }))
  const currentLocaleOption = MOBILE_LANGUAGE_OPTIONS.find(
    (option) => option.value === resolvedLocale
  )
  const currentLanguageLabel = t(
    currentLocaleOption?.labelKey ?? 'settings.appearance.language.english',
    currentLocaleOption?.fallback ?? 'English'
  )
  const selectedLanguageLabel =
    uiLanguage === 'system'
      ? t('mobile.settings.language.systemValue', 'System ({{locale}})', {
          locale: currentLanguageLabel
        })
      : t(
          MOBILE_LANGUAGE_OPTIONS.find((option) => option.value === uiLanguage)?.labelKey ??
            'settings.appearance.language.system',
          'System'
        )

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => setPickerVisible(true)}
      >
        <Languages size={16} color={colors.textSecondary} />
        <Text style={styles.rowLabel}>{t('mobile.settings.language.title', 'Language')}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {selectedLanguageLabel}
        </Text>
        <ChevronRight size={16} color={colors.textMuted} />
      </Pressable>
      {languagePersistenceStatus !== 'ok' ? (
        <Text style={styles.languagePersistenceHint} accessibilityRole="alert">
          {languagePersistenceStatus === 'read-failed'
            ? t(
                'mobile.settings.language.readFailed',
                'Language preference could not be loaded. Using system language.'
              )
            : t(
                'mobile.settings.language.writeFailed',
                'Language preference could not be saved. This change may reset after restart.'
              )}
        </Text>
      ) : null}
      <PickerModal<MobileUiLanguage>
        visible={pickerVisible}
        title={t('mobile.settings.language.pickerTitle', 'Language')}
        options={languageOptions}
        selected={uiLanguage}
        onSelect={(value) => void setUiLanguage(value)}
        onClose={() => setPickerVisible(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
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
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowValue: {
    maxWidth: '44%',
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  languagePersistenceHint: {
    color: colors.statusAmber,
    fontSize: typography.metaSize,
    lineHeight: 17,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.md
  }
})
