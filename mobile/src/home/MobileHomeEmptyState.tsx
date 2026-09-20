import { QrCode } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors, radii, spacing } from '../theme/mobile-theme'

const ONBOARDING_STEPS = [
  {
    descFallback: 'Go to Settings > Mobile and generate a pairing QR code.',
    descKey: 'mobile.home.empty.steps.open.body',
    titleFallback: 'Open Orca desktop',
    titleKey: 'mobile.home.empty.steps.open.title'
  },
  {
    descFallback: 'Tap the button above to open the scanner. Point at the QR code on your screen.',
    descKey: 'mobile.home.empty.steps.scan.body',
    titleFallback: 'Scan the code',
    titleKey: 'mobile.home.empty.steps.scan.title'
  },
  {
    descFallback: 'Your desktop will appear here. Everything is encrypted end-to-end.',
    descKey: 'mobile.home.empty.steps.connected.body',
    titleFallback: "You're connected",
    titleKey: 'mobile.home.empty.steps.connected.title'
  }
]

export function MobileHomeEmptyState(props: {
  bottomInset: number
  contentMaxWidth: number
  isWideLayout: boolean
  onPairDesktop: () => void
}) {
  const { t } = useTranslation()

  return (
    <View
      style={[
        styles.emptyContainer,
        { paddingBottom: props.bottomInset },
        props.isWideLayout && {
          maxWidth: props.contentMaxWidth,
          width: '100%',
          alignSelf: 'center'
        }
      ]}
    >
      <View style={styles.emptyHero}>
        <Text style={styles.emptyTitle}>
          {t('mobile.home.empty.title', 'Connect your desktop')}
        </Text>
        <Text style={styles.emptyBody}>
          {t(
            'mobile.home.empty.body',
            'Pair with Orca on your computer to check on your agents, jump into any terminal, and drive work from your phone.'
          )}
        </Text>
        <Pressable style={styles.primaryButton} onPress={props.onPairDesktop}>
          <QrCode size={17} color={colors.bgBase} />
          <Text style={styles.primaryButtonText}>
            {t('mobile.home.empty.pairDesktop', 'Pair Desktop')}
          </Text>
        </Pressable>
      </View>
      <View style={styles.stepsSection}>
        <Text style={styles.sectionHeading}>
          {t('mobile.home.empty.howItWorks', 'How it works')}
        </Text>
        {ONBOARDING_STEPS.map((step, index) => (
          <View key={step.titleKey} style={[styles.stepRow, index > 0 && styles.stepRowBorder]}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{index + 1}</Text>
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{t(step.titleKey, step.titleFallback)}</Text>
              <Text style={styles.stepDesc}>{t(step.descKey, step.descFallback)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  emptyContainer: { flex: 1 },
  emptyHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 10
  },
  emptyBody: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: radii.card
  },
  primaryButtonText: { color: colors.bgBase, fontSize: 15, fontWeight: '700' },
  stepsSection: { paddingHorizontal: spacing.xl },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: spacing.lg
  },
  stepRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1
  },
  stepNumText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  stepText: { flex: 1 },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 3
  },
  stepDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 17 }
})
