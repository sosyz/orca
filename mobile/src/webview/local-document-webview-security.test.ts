import { describe, expect, it } from 'vitest'
import { LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS } from './local-document-webview-security'

describe('local document WebView security', () => {
  it('blocks local files and insecure mixed content', () => {
    expect(LOCAL_DOCUMENT_WEBVIEW_SECURITY_PROPS).toEqual({
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      mixedContentMode: 'never'
    })
  })
})
