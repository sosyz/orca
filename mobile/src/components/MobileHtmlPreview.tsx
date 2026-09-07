import { useMemo, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Code, Eye } from 'lucide-react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS } from '../webview/local-document-webview-security'

type Props = {
  html: string
  // Rendered when the user flips to "Source" (the existing syntax view).
  renderSource: () => React.ReactNode
}

export const MOBILE_HTML_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'"

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${MOBILE_HTML_PREVIEW_CSP}" />`

export function buildMobileHtmlPreviewDocument(html: string): string {
  const headOpen = html.match(/<head(?:\s[^>]*)?>/i)
  if (headOpen?.index != null) {
    const insertAt = headOpen.index + headOpen[0].length
    return `${html.slice(0, insertAt)}${CSP_META_TAG}${html.slice(insertAt)}`
  }

  const htmlOpen = html.match(/<html(?:\s[^>]*)?>/i)
  if (htmlOpen?.index != null) {
    const insertAt = htmlOpen.index + htmlOpen[0].length
    return `${html.slice(0, insertAt)}<head>${CSP_META_TAG}</head>${html.slice(insertAt)}`
  }

  return `<!doctype html><html><head>${CSP_META_TAG}</head><body>${html}</body></html>`
}

export function isAllowedMobileHtmlPreviewNavigation(url: string): boolean {
  if (url === 'about:blank') {
    return true
  }
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function shouldOpenMobileHtmlPreviewExternally(
  url: string,
  navigationType: string
): boolean {
  return (
    navigationType === 'click' && isAllowedMobileHtmlPreviewNavigation(url) && url !== 'about:blank'
  )
}

// Renders an agent-produced HTML artifact in a sandboxed WebView, with a
// Preview/Source toggle. Navigation is locked: only the initial inline document
// loads in-place; platforms that identify a user click may open its HTTP(S)
// target externally, while automatic navigation remains blocked.
export function MobileHtmlPreview({ html, renderSource }: Props) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const previewDocument = useMemo(() => buildMobileHtmlPreviewDocument(html), [html])
  const previewSource = useMemo(() => ({ html: previewDocument }), [previewDocument])

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable
          style={[styles.toggle, mode === 'preview' && styles.toggleActive]}
          onPress={() => setMode('preview')}
          accessibilityLabel="Preview rendered HTML"
        >
          <Eye size={13} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.toggleText}>Preview</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, mode === 'source' && styles.toggleActive]}
          onPress={() => setMode('source')}
          accessibilityLabel="View HTML source"
        >
          <Code size={13} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.toggleText}>Source</Text>
        </Pressable>
      </View>
      {mode === 'preview' ? (
        <WebView
          style={styles.webview}
          originWhitelist={['about:blank', 'http://*', 'https://*']}
          source={previewSource}
          javaScriptEnabled={false}
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          {...LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS}
          // Why: only the initial about:blank inline-HTML load is allowed in
          // place; a tapped link opens in the system browser instead of
          // navigating the review WebView away from the artifact.
          onShouldStartLoadWithRequest={(request) => {
            if (request.url === 'about:blank') {
              return true
            }
            if (shouldOpenMobileHtmlPreviewExternally(request.url, request.navigationType)) {
              void Linking.openURL(request.url).catch(() => {})
            }
            return false
          }}
        />
      ) : (
        renderSource()
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.bgRaised
  },
  toggleActive: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  toggleText: { color: colors.textSecondary, fontSize: typography.metaSize },
  webview: { flex: 1, backgroundColor: '#ffffff' }
})
