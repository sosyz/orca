import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMobileHtmlPreviewDocument,
  isAllowedMobileHtmlPreviewNavigation,
  MobileHtmlPreview,
  MOBILE_HTML_PREVIEW_CSP,
  shouldOpenMobileHtmlPreviewExternally
} from './MobileHtmlPreview'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))
vi.mock('lucide-react-native', () => ({ Code: 'Code', Eye: 'Eye' }))

describe('MobileHtmlPreview security boundaries', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('adds a restrictive CSP to complete and fragment HTML documents', () => {
    const complete = buildMobileHtmlPreviewDocument(
      '<html><head><title>Report</title></head></html>'
    )
    const fragment = buildMobileHtmlPreviewDocument('<p>Report</p>')

    expect(complete).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${MOBILE_HTML_PREVIEW_CSP}" />`
    )
    expect(fragment).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${MOBILE_HTML_PREVIEW_CSP}" />`
    )
    expect(MOBILE_HTML_PREVIEW_CSP).toContain("script-src 'none'")
    expect(MOBILE_HTML_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(MOBILE_HTML_PREVIEW_CSP).toContain("object-src 'none'")
  })

  it('allows only the inline document and HTTP(S) external links', () => {
    expect(isAllowedMobileHtmlPreviewNavigation('about:blank')).toBe(true)
    expect(isAllowedMobileHtmlPreviewNavigation('http://example.com/report')).toBe(true)
    expect(isAllowedMobileHtmlPreviewNavigation('https://example.com/report')).toBe(true)
    expect(isAllowedMobileHtmlPreviewNavigation('file:///tmp/report.html')).toBe(false)
    expect(isAllowedMobileHtmlPreviewNavigation('data:text/html,<script>evil()</script>')).toBe(
      false
    )
    expect(isAllowedMobileHtmlPreviewNavigation('javascript:alert(1)')).toBe(false)
    expect(shouldOpenMobileHtmlPreviewExternally('https://example.com/report', 'click')).toBe(true)
    expect(shouldOpenMobileHtmlPreviewExternally('https://example.com/report', 'other')).toBe(false)
  })

  it('disables script, storage, and file access in the WebView', () => {
    act(() => {
      renderer = create(
        createElement(MobileHtmlPreview, {
          html: '<p>Report</p>',
          renderSource: () => createElement('Text', null, 'source')
        })
      )
    })

    const webView = renderer?.root.findAllByType('WebView')[0]
    expect(webView?.props).toMatchObject({
      originWhitelist: ['about:blank', 'http://*', 'https://*'],
      javaScriptEnabled: false,
      domStorageEnabled: false,
      cacheEnabled: false,
      incognito: true,
      mixedContentMode: 'never',
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false
    })
    expect(webView?.props.source.html).toContain(MOBILE_HTML_PREVIEW_CSP)
  })

  it('keeps the WebView source object stable across same-html rerenders', () => {
    act(() => {
      renderer = create(
        createElement(MobileHtmlPreview, {
          html: '<p>Report</p>',
          renderSource: () => createElement('Text', null, 'source')
        })
      )
    })
    const firstSource = renderer?.root.findAllByType('WebView')[0]?.props.source

    act(() => {
      renderer?.update(
        createElement(MobileHtmlPreview, {
          html: '<p>Report</p>',
          renderSource: () => createElement('Text', null, 'updated source')
        })
      )
    })

    expect(renderer?.root.findAllByType('WebView')[0]?.props.source).toBe(firstSource)
  })
})
