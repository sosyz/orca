import { useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { triggerSelection } from '../platform/haptics'
import { colors, radii, spacing } from '../theme/mobile-theme'
import type { DragReorderListProps } from './DragReorderListContract'
import { moveDragReorderKeyByOffset } from './drag-reorder-positions'

export type { DragReorderListProps } from './DragReorderListContract'

export function DragReorderList<ItemT>({
  items,
  itemKey,
  onReorder,
  renderRow,
  rowHeight
}: DragReorderListProps<ItemT>): React.JSX.Element {
  const keys = useMemo(() => items.map(itemKey), [items, itemKey])
  const count = keys.length

  const moveRow = useCallback(
    (key: string, delta: number) => {
      const next = moveDragReorderKeyByOffset(keys, key, delta)
      if (next === keys) {
        return
      }
      triggerSelection()
      onReorder(next)
    },
    [keys, onReorder]
  )

  return (
    <View style={{ minHeight: count * rowHeight }}>
      {items.map((item, index) => {
        const key = itemKey(item)
        const isFirst = index === 0
        const isLast = index === count - 1
        return (
          <View key={key} style={[styles.row, { height: rowHeight }]}>
            <View style={styles.rowContent}>{renderRow(item)}</View>
            <View style={styles.controls} accessibilityRole="toolbar">
              <MoveButton disabled={isFirst} direction="up" onPress={() => moveRow(key, -1)} />
              <MoveButton disabled={isLast} direction="down" onPress={() => moveRow(key, 1)} />
            </View>
            <View style={styles.rowSeparator} />
          </View>
        )
      })}
    </View>
  )
}

function MoveButton({
  direction,
  disabled,
  onPress
}: {
  direction: 'up' | 'down'
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  const Icon = direction === 'up' ? ChevronUp : ChevronDown
  return (
    <Pressable
      accessibilityLabel={direction === 'up' ? 'Move up' : 'Move down'}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.moveButton,
        pressed && !disabled && styles.moveButtonPressed,
        disabled && styles.moveButtonDisabled
      ]}
    >
      <Icon size={16} color={disabled ? colors.textMuted : colors.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPanel
  },
  rowContent: {
    flex: 1,
    height: '100%',
    minWidth: 0
  },
  controls: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  moveButton: {
    width: 44,
    height: 44,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  moveButtonDisabled: {
    opacity: 0.35
  },
  moveButtonPressed: {
    backgroundColor: colors.borderSubtle
  },
  rowSeparator: {
    position: 'absolute',
    bottom: 0,
    left: spacing.md,
    right: spacing.md,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle
  }
})
