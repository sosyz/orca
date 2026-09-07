import { Minus, Plus } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { MOBILE_CODE_TEXT_SCALE_MAX, MOBILE_CODE_TEXT_SCALE_MIN } from './mobile-code-text-scale'

type Props = {
  textScale: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
}

export function MobileCodeScaleControls({ textScale, onZoomOut, onZoomIn, onReset }: Props) {
  const percentage = Math.round(textScale * 100)
  const atMinimum = textScale <= MOBILE_CODE_TEXT_SCALE_MIN
  const atMaximum = textScale >= MOBILE_CODE_TEXT_SCALE_MAX

  return (
    <View style={styles.toolbar} accessibilityLabel="Code text size controls">
      <Pressable
        style={[styles.button, atMinimum && styles.buttonDisabled]}
        disabled={atMinimum}
        onPress={onZoomOut}
        accessibilityRole="button"
        accessibilityLabel="Decrease code text size"
      >
        <Minus size={15} color={atMinimum ? colors.textMuted : colors.textSecondary} />
      </Pressable>
      <Pressable
        style={styles.percentageButton}
        onPress={onReset}
        accessibilityRole="button"
        accessibilityLabel="Reset code text size"
        accessibilityValue={{ text: `${percentage}%` }}
      >
        <Text style={styles.percentageText}>{percentage}%</Text>
      </Pressable>
      <Pressable
        style={[styles.button, atMaximum && styles.buttonDisabled]}
        disabled={atMaximum}
        onPress={onZoomIn}
        accessibilityRole="button"
        accessibilityLabel="Increase code text size"
      >
        <Plus size={15} color={atMaximum ? colors.textMuted : colors.textSecondary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  toolbar: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  button: {
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.row,
    backgroundColor: colors.bgRaised
  },
  buttonDisabled: {
    opacity: 0.45
  },
  percentageButton: {
    minWidth: 52,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.row
  },
  percentageText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    fontWeight: '600'
  }
})
