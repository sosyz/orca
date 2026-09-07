import { forwardRef } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { View } from 'react-native'
import { WebView, type WebViewProps } from 'react-native-webview'
import { LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS } from '../webview/local-document-webview-security'
import { TerminalWebViewEngineErrorOverlay } from './terminal-webview-engine-error-state'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'
import { HARMONY_TERMINAL_BOOTSTRAP_JS, XTERM_WEBVIEW_SOURCE } from './terminal-webview-html'
import { isTerminalWebViewNavigationAllowed } from './terminal-webview-navigation-policy'
import type { TerminalBridgeReadinessStrategy } from './terminal-webview-platform-policy'

type TerminalWebViewEventProps = Pick<
  WebViewProps,
  | 'onContentProcessDidTerminate'
  | 'onError'
  | 'onHttpError'
  | 'onLoadStart'
  | 'onMessage'
  | 'onRenderProcessGone'
>

type TerminalWebViewSurfaceProps = TerminalWebViewEventProps & {
  bridgeReadiness: TerminalBridgeReadinessStrategy
  engineError: string | null
  frameStyle?: StyleProp<ViewStyle>
  generation: number
  onReload: () => void
}

export const TerminalWebViewSurface = forwardRef<WebView, TerminalWebViewSurfaceProps>(
  function TerminalWebViewSurface(
    { bridgeReadiness, engineError, frameStyle, generation, onReload, ...eventProps },
    ref
  ) {
    return (
      <View style={[TERMINAL_WEBVIEW_FRAME_STYLES.container, frameStyle]}>
        <WebView
          key={generation}
          ref={ref}
          source={XTERM_WEBVIEW_SOURCE}
          injectedJavaScriptBeforeContentLoaded={
            bridgeReadiness === 'native-ack-gated' ? HARMONY_TERMINAL_BOOTSTRAP_JS : undefined
          }
          style={TERMINAL_WEBVIEW_FRAME_STYLES.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          {...LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS}
          scrollEnabled={false}
          nestedScrollEnabled
          scalesPageToFit={false}
          textZoom={100}
          onShouldStartLoadWithRequest={(request) =>
            isTerminalWebViewNavigationAllowed(request.url)
          }
          {...eventProps}
        />
        {engineError ? (
          <TerminalWebViewEngineErrorOverlay message={engineError} onReload={onReload} />
        ) : null}
      </View>
    )
  }
)
