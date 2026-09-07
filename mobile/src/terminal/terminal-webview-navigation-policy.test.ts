import { describe, expect, it } from 'vitest'
import { isTerminalWebViewNavigationAllowed } from './terminal-webview-navigation-policy'

describe('terminal WebView navigation policy', () => {
  it.each(['about:blank', 'data:text/html;base64,PGgxPk9yY2E8L2gxPg==', 'blob:null/session'])(
    'allows local document URL %s',
    (url) => {
      expect(isTerminalWebViewNavigationAllowed(url)).toBe(true)
    }
  )

  it.each([
    'https://attacker.example/',
    'http://attacker.example/',
    'file:///data/storage/el2/base/private/token',
    'resource://rawfile/private',
    'javascript:alert(1)',
    'mailto:test@example.com',
    ''
  ])('blocks non-local navigation %s', (url) => {
    expect(isTerminalWebViewNavigationAllowed(url)).toBe(false)
  })
})
