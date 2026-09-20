import { useCallback } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { TerminalWebView } from '../terminal/TerminalWebView'
import { getTerminalPaneWebViewState } from '../terminal/terminal-webview-platform-policy'
import type {
  MobileTerminalTheme,
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes,
  TerminalWebViewHandle
} from '../terminal/terminal-webview-contract'

export type TerminalPaneViewProps = {
  handle: string
  active: boolean
  covered: boolean
  retained?: boolean
  keyboardLift: number
  terminalTheme?: MobileTerminalTheme
  textScale: number
  onRef: (handle: string, ref: TerminalWebViewHandle | null) => void
  onWebReady: (handle: string) => void
  onSelectionMode: (handle: string, active: boolean) => void
  onSelectionCopy: (handle: string, text: string) => void
  onSelectionEvicted: (handle: string) => void
  onModesChanged: (handle: string, modes: TerminalModes) => void
  onKeyboardAvoidanceMetrics: (handle: string, metrics: TerminalKeyboardAvoidanceMetrics) => void
  onHaptic: (kind: 'selection' | 'success' | 'error' | 'edge-bump') => void
  onTerminalInput: (handle: string, bytes: string) => void
  onTerminalQueryReply: (handle: string, bytes: string) => void
  onTerminalTap: (handle: string) => void
  onFileTap: (handle: string, pathText: string, line: number | null, column: number | null) => void
  onOpenUrl: (handle: string, url: string) => void
  onTextScaleChange: (scale: number) => void
}

export function TerminalPaneView({
  handle,
  active,
  covered,
  retained = false,
  keyboardLift,
  terminalTheme,
  textScale,
  onRef,
  onWebReady,
  onSelectionMode,
  onSelectionCopy,
  onSelectionEvicted,
  onModesChanged,
  onKeyboardAvoidanceMetrics,
  onHaptic,
  onTerminalInput,
  onTerminalQueryReply,
  onTerminalTap,
  onFileTap,
  onOpenUrl,
  onTextScaleChange
}: TerminalPaneViewProps) {
  const { hiddenPanePresentation, shouldMountWebView, webViewActive } = getTerminalPaneWebViewState(
    {
      active,
      covered,
      retained,
      platform: Platform.OS as string
    }
  )
  const setRef = useCallback(
    (ref: TerminalWebViewHandle | null) => {
      onRef(handle, ref)
    },
    [handle, onRef]
  )

  return (
    <View
      // Harmony defers ArkWeb creation until chat stops covering the active pane.
      pointerEvents={webViewActive ? 'auto' : 'none'}
      style={[
        styles.terminalPane,
        keyboardLift > 0 && { transform: [{ translateY: -keyboardLift }] },
        !webViewActive &&
          (hiddenPanePresentation === 'display-none'
            ? styles.terminalPaneParked
            : styles.terminalPaneHidden)
      ]}
    >
      {shouldMountWebView ? (
        <TerminalWebView
          ref={setRef}
          active={webViewActive}
          style={styles.terminalWebView}
          terminalTheme={terminalTheme}
          textScale={textScale}
          onWebReady={() => onWebReady(handle)}
          onSelectionMode={(a) => onSelectionMode(handle, a)}
          onSelectionCopy={(t) => onSelectionCopy(handle, t)}
          onSelectionEvicted={() => onSelectionEvicted(handle)}
          onModesChanged={(m) => onModesChanged(handle, m)}
          onKeyboardAvoidanceMetrics={(m) => onKeyboardAvoidanceMetrics(handle, m)}
          onHaptic={onHaptic}
          onTerminalInput={(bytes) => onTerminalInput(handle, bytes)}
          onTerminalQueryReply={(bytes) => onTerminalQueryReply(handle, bytes)}
          onTerminalTap={() => onTerminalTap(handle)}
          onFileTap={(pathText, line, column) => onFileTap(handle, pathText, line, column)}
          onOpenUrl={(url) => onOpenUrl(handle, url)}
          onTextScaleChange={onTextScaleChange}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  terminalPane: {
    ...StyleSheet.absoluteFillObject
  },
  terminalPaneHidden: {
    opacity: 0
  },
  terminalPaneParked: {
    display: 'none'
  },
  terminalWebView: {
    flex: 1
  }
})
