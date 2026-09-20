import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors, typography } from '../theme/mobile-theme'

type DictationStatus = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: DictationStatus
  readonly isAttaching: boolean
  readonly liveInputText: string
}

export function MobileTerminalLiveInputStatus({
  dictation,
  isAttaching,
  liveInputText
}: MobileTerminalLiveInputStatusProps) {
  const { t } = useTranslation()
  const title = dictation.isRecording
    ? t('mobile.session.terminalInput.status.recordingTitle', 'Listening')
    : dictation.isProcessing
      ? t('mobile.session.terminalInput.status.processingTitle', 'Processing')
      : dictation.isStarting
        ? t('mobile.session.terminalInput.status.startingTitle', 'Starting mic')
        : t('mobile.session.terminalInput.status.liveTitle', 'Live input')
  const detail = dictation.isRecording
    ? t('mobile.session.terminalInput.status.recordingDetail', 'Tap mic to stop')
    : dictation.isProcessing
      ? t('mobile.session.terminalInput.status.processingDetail', 'Transcribing on desktop')
      : dictation.isStarting
        ? t('mobile.session.terminalInput.status.startingDetail', 'Preparing microphone')
        : isAttaching
          ? t('mobile.session.terminalInput.status.uploadingImageDetail', 'Uploading image to host')
          : liveInputText ||
            t('mobile.session.terminalInput.status.liveDetail', 'Tap to show keyboard')

  return (
    <View style={styles.status}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.detail} numberOfLines={1} ellipsizeMode="head">
        {detail}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    gap: 1
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  detail: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  }
})
