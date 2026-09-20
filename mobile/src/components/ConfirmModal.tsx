import { useLayoutEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors, spacing, radii, typography } from '../theme/mobile-theme'
import { BottomDrawer } from './BottomDrawer'

type Props = {
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel
}: Props) {
  const { t } = useTranslation()
  const [openToken, setOpenToken] = useState<object>(() => ({}))
  const [resetOnNextOpen, setResetOnNextOpen] = useState(false)
  const [previousVisible, setPreviousVisible] = useState(visible)
  const committedOpenTokenRef = useRef<object | null>(null)
  const shouldResetOpening = visible && (resetOnNextOpen || !previousVisible)
  if (visible !== previousVisible || shouldResetOpening) {
    setPreviousVisible(visible)
    if (shouldResetOpening) {
      setOpenToken({})
      setResetOnNextOpen(false)
    }
  }

  useLayoutEffect(() => {
    const committedToken = visible ? openToken : null
    committedOpenTokenRef.current = committedToken
    return () => {
      if (committedOpenTokenRef.current === committedToken) {
        committedOpenTokenRef.current = null
      }
    }
  }, [openToken, visible])

  function consumeOpening() {
    if (!visible || committedOpenTokenRef.current !== openToken) {
      return false
    }
    // Closing drawers retain their buttons until the animation finishes.
    committedOpenTokenRef.current = null
    setResetOnNextOpen(true)
    return true
  }

  function handleCancel() {
    if (consumeOpening()) {
      onCancel()
    }
  }

  function handleConfirm() {
    if (consumeOpening()) {
      onConfirm()
      onCancel()
    }
  }

  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm', 'Confirm')
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel', 'Cancel')

  return (
    <BottomDrawer visible={visible} onClose={handleCancel}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
          onPress={handleCancel}
        >
          <Text style={styles.cancelText}>{resolvedCancelLabel}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            destructive ? styles.destructiveButton : styles.confirmButton,
            pressed && styles.pressed
          ]}
          onPress={handleConfirm}
        >
          <Text style={destructive ? styles.destructiveText : styles.confirmText}>
            {resolvedConfirmLabel}
          </Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.lg
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary
  },
  message: {
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  button: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    alignItems: 'center'
  },
  cancelButton: {
    backgroundColor: colors.bgPanel
  },
  confirmButton: {
    backgroundColor: colors.textPrimary
  },
  destructiveButton: {
    backgroundColor: colors.statusRed
  },
  pressed: {
    opacity: 0.7
  },
  cancelText: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textSecondary
  },
  confirmText: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.bgBase
  },
  destructiveText: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: '#fff'
  }
})
