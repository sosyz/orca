import { forwardRef, useCallback, useImperativeHandle, useState, type RefObject } from 'react'
import { Keyboard as KeyboardIcon } from 'lucide-react-native'
import { Platform, Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { getTerminalLiveInputKeyboardType } from '../terminal/terminal-keyboard-type'
import { colors } from '../theme/mobile-theme'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'
import { MobileTerminalLiveInputStatus } from './MobileTerminalLiveInputStatus'
import { styles } from './mobile-session-styles'

type DictationState = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

export type MobileTerminalLiveInputBarHandle = {
  readonly setCaptureText: (text: string) => void
}

type MobileTerminalLiveInputBarProps = {
  readonly canSend: boolean
  readonly dictation: DictationState
  readonly dictationMode: 'toggle' | 'hold'
  readonly inputRef: RefObject<TextInput | null>
  readonly isAttaching: boolean
  readonly onAttachFile: () => void
  readonly onAttachImage: () => void
  readonly onChange: NonNullable<TextInputProps['onChange']>
  readonly onDictationCancel: () => void
  readonly onDictationPressIn: () => void
  readonly onDictationPressOut: () => void
  readonly onDictationToggle: () => void
  readonly onFocusLiveInput: () => void
  readonly onKeyPress: NonNullable<TextInputProps['onKeyPress']>
  readonly onSubmitEditing: NonNullable<TextInputProps['onSubmitEditing']>
}

export const MobileTerminalLiveInputBar = forwardRef<
  MobileTerminalLiveInputBarHandle,
  MobileTerminalLiveInputBarProps
>(function MobileTerminalLiveInputBar(
  {
    canSend,
    dictation,
    dictationMode,
    inputRef,
    isAttaching,
    onAttachFile,
    onAttachImage,
    onChange,
    onDictationCancel,
    onDictationPressIn,
    onDictationPressOut,
    onDictationToggle,
    onFocusLiveInput,
    onKeyPress,
    onSubmitEditing
  },
  ref
) {
  const [liveInputText, setLiveInputText] = useState('')
  const setCaptureText = useCallback((text: string) => {
    setLiveInputText(text)
  }, [])

  useImperativeHandle(ref, () => ({ setCaptureText }), [setCaptureText])

  return (
    <View style={[styles.inputBar, styles.liveInputBar]}>
      <Pressable
        style={({ pressed }) => [
          styles.liveInputFocusTarget,
          pressed && styles.liveInputFocusTargetPressed,
          !canSend && styles.liveInputFocusTargetDisabled
        ]}
        disabled={!canSend}
        onPress={onFocusLiveInput}
        accessibilityRole="button"
        accessibilityLabel="Show keyboard for live terminal input"
        accessibilityHint="Typed text is sent directly to the active terminal"
      >
        <KeyboardIcon size={16} color={colors.textSecondary} strokeWidth={2} />
        <MobileTerminalLiveInputStatus
          dictation={dictation}
          isAttaching={isAttaching}
          liveInputText={liveInputText}
        />
      </Pressable>
      <MobileTerminalInputActions
        canSend={canSend}
        isAttaching={isAttaching}
        dictation={dictation}
        dictationMode={dictationMode}
        buttonStyle={styles.dictationButton}
        activeButtonStyle={styles.dictationButtonActive}
        disabledButtonStyle={styles.sendButtonDisabled}
        onAttachImage={onAttachImage}
        onAttachFile={onAttachFile}
        onDictationToggle={onDictationToggle}
        onDictationPressIn={onDictationPressIn}
        onDictationPressOut={onDictationPressOut}
        onDictationCancel={onDictationCancel}
      />
      <TextInput
        ref={inputRef}
        style={styles.liveInputCapture}
        value={liveInputText}
        // Why onChange, not onChangeText: only the raw native event carries the
        // marked-text report that says whether this text is still preedit.
        onChange={onChange}
        onKeyPress={onKeyPress}
        onSubmitEditing={onSubmitEditing}
        placeholder=""
        showSoftInputOnFocus
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        smartInsertDelete={false}
        // Why: iOS textContentType overrides autoComplete and can narrow the keyboard; keep IME switching available.
        autoComplete="off"
        keyboardType={getTerminalLiveInputKeyboardType(Platform.OS)}
        returnKeyType="default"
        blurOnSubmit={false}
        editable={canSend}
        importantForAutofill="no"
      />
    </View>
  )
})
