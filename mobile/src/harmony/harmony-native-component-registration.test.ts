import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageProvider = readFileSync(
  resolve(import.meta.dirname, '../../harmony/entry/src/main/ets/PackageProvider.ets'),
  'utf8'
)

describe('Harmony native component registration', () => {
  it('registers the ArkTS Web component builder used by RNCWebView descriptors', () => {
    expect(packageProvider).toContain('import { WebView, WebViewPackage }')
    expect(packageProvider).toContain('@Builder\nfunction buildHarmonyWebView(')
    expect(packageProvider).toContain('ctx: ctx.rnComponentContext')
    expect(packageProvider).toContain('tag: ctx.tag')
    expect(packageProvider).toContain('class HarmonyWebViewPackage extends WebViewPackage')
    expect(packageProvider).toContain('.set(WebView.NAME, wrapBuilder(buildHarmonyWebView))')
    expect(packageProvider).toContain('new HarmonyWebViewPackage(context)')
    expect(packageProvider).not.toContain('new WebViewPackage(context)')
  })
})
