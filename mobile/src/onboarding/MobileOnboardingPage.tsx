import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { BellRing, MessageSquare } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import type { MobileOnboardingStep } from './mobile-onboarding-plan'
import { mobileOnboardingStyles as styles } from './mobile-onboarding-styles'
import type { MobileSessionView } from '../storage/session-view-preferences'
import { colors } from '../theme/mobile-theme'

export type NotificationOnboardingChoice = 'enable' | 'skip'
export type MobileOnboardingBusyChoice = MobileSessionView | NotificationOnboardingChoice | null

type Props = {
  step: MobileOnboardingStep
  width: number
  active: boolean
  busyChoice: MobileOnboardingBusyChoice
  error: string | null
  onSessionChoice: (view: MobileSessionView) => void
  onNotificationChoice: (choice: NotificationOnboardingChoice) => void
}

export function MobileOnboardingPage({
  step,
  width,
  active,
  busyChoice,
  error,
  onSessionChoice,
  onNotificationChoice
}: Props) {
  const { t } = useTranslation()
  const busy = busyChoice !== null
  const isSessionView = step === 'session-view'

  return (
    <ScrollView
      style={[styles.page, { width }]}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <View style={styles.content}>
        <View style={styles.iconSurface}>
          {isSessionView ? (
            <MessageSquare size={30} color={colors.textPrimary} />
          ) : (
            <BellRing size={30} color={colors.textPrimary} />
          )}
        </View>
        <Text style={styles.title}>
          {isSessionView
            ? t('mobile.onboarding.sessionView.title', 'How should sessions open?')
            : t('mobile.onboarding.notifications.title', 'Stay updated while away')}
        </Text>
        <Text style={styles.body}>
          {isSessionView
            ? t(
                'mobile.onboarding.sessionView.body',
                'Choose whether supported agent sessions open in the terminal or Chat UI on this device. Press and hold a session tab to switch its view, or change the default later in Settings.'
              )
            : t(
                'mobile.onboarding.notifications.body',
                'Get notified on this device when an agent needs your input or finishes a task.'
              )}
        </Text>
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {isSessionView ? (
          <SessionViewChoices busyChoice={busyChoice} disabled={busy} onChoice={onSessionChoice} />
        ) : (
          <NotificationChoices
            busyChoice={busyChoice}
            disabled={busy}
            onChoice={onNotificationChoice}
          />
        )}
      </View>
    </ScrollView>
  )
}

function SessionViewChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (view: MobileSessionView) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <ChoiceButton
        label={t('mobile.onboarding.sessionView.chat', 'Use Chat UI')}
        accessibilityLabel={t('mobile.onboarding.sessionView.chatA11y', 'Open sessions in Chat UI')}
        primary
        busy={busyChoice === 'chat'}
        disabled={disabled}
        onPress={() => onChoice('chat')}
      />
      <ChoiceButton
        label={t('mobile.onboarding.sessionView.terminal', 'Keep terminal')}
        accessibilityLabel={t(
          'mobile.onboarding.sessionView.terminalA11y',
          'Open sessions in the terminal'
        )}
        busy={busyChoice === 'terminal'}
        disabled={disabled}
        onPress={() => onChoice('terminal')}
      />
    </>
  )
}

function NotificationChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (choice: NotificationOnboardingChoice) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <ChoiceButton
        label={t('mobile.onboarding.notifications.enable', 'Enable notifications')}
        accessibilityLabel={t(
          'mobile.onboarding.notifications.enableA11y',
          'Enable agent notifications'
        )}
        primary
        busy={busyChoice === 'enable'}
        disabled={disabled}
        onPress={() => onChoice('enable')}
      />
      <ChoiceButton
        label={t('mobile.onboarding.notifications.skip', 'Not now')}
        accessibilityLabel={t(
          'mobile.onboarding.notifications.skipA11y',
          'Skip notifications for now'
        )}
        busy={busyChoice === 'skip'}
        disabled={disabled}
        onPress={() => onChoice('skip')}
      />
    </>
  )
}

function ChoiceButton({
  label,
  accessibilityLabel,
  primary = false,
  busy,
  disabled,
  onPress
}: {
  label: string
  accessibilityLabel?: string
  primary?: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      style={({ pressed }) => [
        primary ? styles.primaryButton : styles.secondaryButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.bgBase : colors.textSecondary} />
      ) : (
        <Text style={primary ? styles.primaryButtonText : styles.secondaryButtonText}>{label}</Text>
      )}
    </Pressable>
  )
}
