import type { WebViewProps } from 'react-native-webview'

type LocalDocumentWebViewSecurityProps = Pick<
  WebViewProps,
  | 'allowFileAccess'
  | 'allowFileAccessFromFileURLs'
  | 'allowUniversalAccessFromFileURLs'
  | 'mixedContentMode'
>

export const LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS = {
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  mixedContentMode: 'never'
} as const satisfies LocalDocumentWebViewSecurityProps
