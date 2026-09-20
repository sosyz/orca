import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  type PanResponderInstance,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { MobileBrowserAddressField } from './MobileBrowserAddressField'
import { MobileBrowserKeyRow } from './MobileBrowserKeyRow'
import {
  MobileBrowserPointerModifiers,
  type BrowserPointerModifier
} from './MobileBrowserPointerModifiers'
import { MobileBrowserToolbarIconButton } from './MobileBrowserToolbarIconButton'
import { MobileBrowserViewModeSwitch } from './MobileBrowserViewModeSwitch'
import { buttonColor, type FrameLayer } from './mobile-browser-frame-state'
import { mobileBrowserPaneStyles as styles } from './mobile-browser-pane-styles'
import type {
  BrowserFrameGeometry,
  BrowserTouchLayout,
  BrowserZoomState
} from './browser-touch-geometry'
import type { MobileBrowserCopy } from './mobile-browser-copy'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import type { MobileBrowserTab } from './MobileBrowserPane'

type MobileBrowserPaneViewProps = {
  addressFocused: boolean
  addressValue: string
  bottomInset: number
  browserLayerRef: (layer: FrameLayer) => (view: View | null) => void
  browserViewMode: MobileBrowserViewMode
  busy: boolean
  controlsDisabled: boolean
  copy: MobileBrowserCopy
  dialog: { dialogType: string; message: string } | null
  error: string | null
  frameGeometry: BrowserFrameGeometry | null
  frameLayerErrorHandler: (layer: FrameLayer) => (event?: unknown) => void
  frameLayerLoadHandler: (layer: FrameLayer) => (event?: unknown) => void
  frameLayerRef: (layer: FrameLayer) => (image: Image | null) => void
  frameLayerStyle: (layer: FrameLayer) => StyleProp<ViewStyle>
  goBack: () => void
  goForward: () => void
  hasFrameSource: boolean
  hasRenderedFrame: boolean
  keyboardLift: number
  keyboardValue: string
  layoutRef: RefObject<BrowserTouchLayout | null>
  navigateToAddress: () => Promise<void>
  pageInputDisabled: boolean
  panResponder: PanResponderInstance
  pointerModifiers: BrowserPointerModifier[]
  reloadPage: () => void
  selectBrowserViewMode: (mode: MobileBrowserViewMode) => void
  sendDialogCommand: (method: 'browser.dialogDismiss' | 'browser.dialogAccept') => Promise<void>
  sendKeyboardText: () => Promise<void>
  sendKeypress: (key: string) => Promise<void>
  setAddressFocused: Dispatch<SetStateAction<boolean>>
  setAddressValue: Dispatch<SetStateAction<string>>
  setKeyboardValue: Dispatch<SetStateAction<string>>
  setLayout: Dispatch<SetStateAction<BrowserTouchLayout | null>>
  setRootViewRef: (view: View | null) => void
  tab: MobileBrowserTab
  togglePointerModifier: (modifier: BrowserPointerModifier) => void
  zoom: BrowserZoomState
}

export function MobileBrowserPaneView(props: MobileBrowserPaneViewProps) {
  const {
    addressFocused,
    addressValue,
    bottomInset,
    browserLayerRef,
    browserViewMode,
    busy,
    controlsDisabled,
    copy,
    dialog,
    error,
    frameGeometry,
    frameLayerErrorHandler,
    frameLayerLoadHandler,
    frameLayerRef,
    frameLayerStyle,
    goBack,
    goForward,
    hasFrameSource,
    hasRenderedFrame,
    keyboardLift,
    keyboardValue,
    layoutRef,
    navigateToAddress,
    pageInputDisabled,
    panResponder,
    pointerModifiers,
    reloadPage,
    selectBrowserViewMode,
    sendDialogCommand,
    sendKeyboardText,
    sendKeypress,
    setAddressFocused,
    setAddressValue,
    setKeyboardValue,
    setLayout,
    setRootViewRef,
    tab,
    togglePointerModifier,
    zoom
  } = props
  return (
    <View ref={setRootViewRef} style={styles.root}>
      <View style={styles.toolbar}>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoBack}
          label={copy.toolbar.back}
          onPress={goBack}
        >
          <ChevronLeft size={15} color={buttonColor(!controlsDisabled && tab.canGoBack)} />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoForward}
          label={copy.toolbar.forward}
          onPress={goForward}
        >
          <ChevronRight size={15} color={buttonColor(!controlsDisabled && tab.canGoForward)} />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled}
          label={copy.toolbar.reload}
          onPress={reloadPage}
        >
          <RefreshCw size={15} color={buttonColor(!controlsDisabled)} />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserAddressField
          value={addressValue}
          onChangeText={setAddressValue}
          onFocus={() => setAddressFocused(true)}
          onBlur={() => setAddressFocused(false)}
          onSubmit={() => void navigateToAddress()}
          focused={addressFocused}
          disabled={controlsDisabled}
          placeholder={copy.addressPlaceholder}
        />
        <MobileBrowserViewModeSwitch
          disabled={controlsDisabled}
          value={browserViewMode}
          onChange={selectBrowserViewMode}
          copy={copy.viewMode}
        />
      </View>

      <View
        style={styles.viewport}
        onLayout={(event) => {
          const next = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height
          }
          const current = layoutRef.current
          if (current && current.width === next.width && current.height === next.height) {
            return
          }
          layoutRef.current = next
          setLayout(next)
        }}
        {...panResponder.panHandlers}
      >
        {hasFrameSource ? (
          <View style={styles.browserImageHost}>
            {frameGeometry ? (
              <View
                pointerEvents="none"
                style={[
                  styles.browserZoomOffset,
                  {
                    width: frameGeometry.renderedWidth,
                    height: frameGeometry.renderedHeight,
                    transform: [{ translateX: zoom.offsetX }, { translateY: zoom.offsetY }]
                  }
                ]}
              >
                <View
                  style={[
                    styles.browserFrameBox,
                    {
                      width: frameGeometry.renderedWidth,
                      height: frameGeometry.renderedHeight,
                      transform: [{ scale: zoom.scale }]
                    }
                  ]}
                >
                  {([0, 1] as const).map((layer) => (
                    <View
                      key={layer}
                      ref={browserLayerRef(layer)}
                      pointerEvents="none"
                      style={frameLayerStyle(layer)}
                    >
                      <Image
                        ref={frameLayerRef(layer)}
                        resizeMode="stretch"
                        fadeDuration={0}
                        onLoad={frameLayerLoadHandler(layer)}
                        onError={frameLayerErrorHandler(layer)}
                        style={[
                          styles.browserImage,
                          {
                            width: frameGeometry.renderedWidth,
                            height: frameGeometry.renderedHeight
                          }
                        ]}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              ([0, 1] as const).map((layer) => (
                <View
                  key={layer}
                  ref={browserLayerRef(layer)}
                  pointerEvents="none"
                  style={frameLayerStyle(layer)}
                >
                  <Image
                    ref={frameLayerRef(layer)}
                    resizeMode="contain"
                    fadeDuration={0}
                    onLoad={frameLayerLoadHandler(layer)}
                    onError={frameLayerErrorHandler(layer)}
                    style={styles.browserImageFill}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
        {!hasRenderedFrame || busy || error ? (
          <View pointerEvents="none" style={styles.overlay}>
            {/* Why: a stream can report ready and then deliver no frames, so key the
                indicator off actually having pixels or it clears into a blank pane. */}
            {busy || (!hasRenderedFrame && !error) ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : null}
        {dialog ? (
          <View style={styles.dialogOverlay}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>{copy.dialog.title}</Text>
              <Text style={styles.dialogMessage}>{dialog.message}</Text>
              <View style={styles.dialogActions}>
                {dialog.dialogType !== 'alert' ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.dialogButton,
                      pressed && styles.dialogButtonPressed
                    ]}
                    onPress={() => void sendDialogCommand('browser.dialogDismiss')}
                  >
                    <Text style={styles.dialogButtonText}>{copy.dialog.cancel}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.dialogButton,
                    styles.dialogButtonPrimary,
                    pressed && styles.dialogButtonPressed
                  ]}
                  onPress={() => void sendDialogCommand('browser.dialogAccept')}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogButtonPrimaryText]}>
                    {copy.dialog.ok}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.keyboardDock,
          { paddingBottom: bottomInset, transform: [{ translateY: -keyboardLift }] }
        ]}
      >
        <MobileBrowserPointerModifiers
          disabled={pageInputDisabled}
          selectedModifiers={pointerModifiers}
          onToggle={togglePointerModifier}
          copy={copy.pointerModifiers}
        />
        <MobileBrowserKeyRow
          disabled={pageInputDisabled}
          onKeypress={(key) => void sendKeypress(key)}
          copy={copy.keyboard.keys}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.keyboardInput}
            value={keyboardValue}
            onChangeText={setKeyboardValue}
            placeholder={copy.keyboard.inputPlaceholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pageInputDisabled}
            onSubmitEditing={() => void sendKeyboardText()}
          />
          <Pressable
            style={[styles.sendButton, (pageInputDisabled || !keyboardValue) && styles.disabled]}
            disabled={pageInputDisabled || !keyboardValue}
            onPress={() => void sendKeyboardText()}
            accessibilityLabel={copy.keyboard.sendTextAccessibilityLabel}
          >
            <ArrowUp size={18} color={buttonColor(!pageInputDisabled && !!keyboardValue)} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}
