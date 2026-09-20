import { Pressable, StyleSheet, View } from 'react-native'
import { Monitor, Smartphone, type LucideIcon } from 'lucide-react-native'
import { colors, radii } from '../theme/mobile-theme'
import type { MobileBrowserCopy } from './mobile-browser-copy'
import type { MobileBrowserViewMode } from './browser-screencast-request'

type Props = {
  copy: MobileBrowserCopy['viewMode']
  disabled: boolean
  value: MobileBrowserViewMode
  onChange: (mode: MobileBrowserViewMode) => void
}

const VIEW_MODES: { id: MobileBrowserViewMode; icon: LucideIcon }[] = [
  { id: 'web', icon: Monitor },
  { id: 'mobile', icon: Smartphone }
]

export function MobileBrowserViewModeSwitch({
  copy,
  disabled,
  value,
  onChange
}: Props): React.JSX.Element {
  return (
    <View style={styles.switch}>
      {VIEW_MODES.map((mode) => (
        <ViewModeButton
          key={mode.id}
          Icon={mode.icon}
          label={copy[mode.id].accessibilityLabel}
          selected={value === mode.id}
          disabled={disabled}
          onPress={() => onChange(mode.id)}
        />
      ))}
    </View>
  )
}

function ViewModeButton({
  Icon,
  disabled,
  label,
  onPress,
  selected
}: {
  Icon: LucideIcon
  disabled?: boolean
  label: string
  onPress: () => void
  selected: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        selected && styles.buttonSelected,
        pressed && !disabled && !selected && styles.buttonPressed,
        disabled && styles.disabled
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
    >
      <Icon size={14} color={selected ? colors.bgBase : colors.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  switch: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    padding: 2
  },
  button: {
    minHeight: 24,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button
  },
  buttonPressed: {
    backgroundColor: colors.borderSubtle
  },
  buttonSelected: {
    backgroundColor: colors.textPrimary
  },
  disabled: {
    opacity: 0.35
  }
})
