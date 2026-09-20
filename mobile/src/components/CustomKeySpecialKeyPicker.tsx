import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  type TerminalShortcutSpecialKey
} from '../terminal/terminal-accessory-keys'
import { customKeyModalStyles as styles } from './CustomKeyModal.styles'

// Why: fixed grids keep F7-F12 from clipping in a ragged wrap row.
const SPECIAL_KEY_GROUPS: {
  id: 'editing' | 'navigation' | 'function'
  ids: string[]
  columns: number
}[] = [
  {
    id: 'editing',
    ids: ['escape', 'tab', 'enter', 'backspace', 'delete', 'insert', 'space'],
    columns: 4
  },
  {
    id: 'navigation',
    ids: ['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight', 'home', 'end', 'pageUp', 'pageDown'],
    columns: 4
  },
  {
    id: 'function',
    ids: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'],
    columns: 6
  }
]

export const SPECIAL_KEY_BY_ID: Record<string, TerminalShortcutSpecialKey> = Object.fromEntries(
  TERMINAL_SHORTCUT_SPECIAL_KEYS.map((key) => [key.id, key])
)

export function CustomKeySpecialKeyPicker({
  selectedKey,
  onPickKey
}: {
  selectedKey: string
  onPickKey: (id: string) => void
}) {
  const { t } = useTranslation()

  return (
    <View style={styles.specialKeysForm}>
      {SPECIAL_KEY_GROUPS.map((group) => (
        <View key={group.id} style={styles.specialGroup}>
          <Text style={styles.specialGroupTitle}>
            {t(
              `mobile.settings.terminalSettings.customShortcuts.modal.specialGroups.${group.id}`,
              group.id === 'editing'
                ? 'Editing'
                : group.id === 'navigation'
                  ? 'Navigation'
                  : 'Function'
            )}
          </Text>
          <View style={styles.keyGrid}>
            {group.ids.map((id) => {
              const key = SPECIAL_KEY_BY_ID[id]
              if (!key) {
                return null
              }
              const selected = selectedKey === id
              const flexBasis = `${100 / group.columns}%` as const
              return (
                <View key={id} style={[styles.keyCellWrap, { flexBasis }]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.keyCell,
                      selected && styles.keyCellSelected,
                      pressed && !selected && styles.keyCellPressed
                    ]}
                    onPress={() => onPickKey(id)}
                    accessibilityLabel={key.accessibilityLabel}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.keyCellText, selected && styles.keyCellTextSelected]}>
                      {key.label}
                    </Text>
                  </Pressable>
                </View>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}
