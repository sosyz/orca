import { describe, expect, it, vi } from 'vitest'
import { createHarmonyLinkingAdapter } from '../../harmony/src/compat/expo-linking'

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  addHarmonyNativeListener: vi.fn(() => ({ remove: vi.fn() })),
  HarmonyNative: {
    getLatestUrlEvent: vi.fn(() => null),
    openApplicationSettings: vi.fn(async () => undefined),
    openExternalUrl: vi.fn(async () => undefined)
  },
  hasHarmonyNativeModule: vi.fn(() => true)
}))

function createAdapter() {
  const openExternalUrl = vi.fn(async (_url: string) => undefined)
  const adapter = createHarmonyLinkingAdapter(
    {
      getLatestUrlEvent: () => null,
      openApplicationSettings: async () => undefined,
      openExternalUrl
    },
    () => ({ remove() {} })
  )
  return { adapter, openExternalUrl }
}

describe('Harmony external URL adapter', () => {
  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    [' http://example.com/path ', 'http://example.com/path'],
    ['https://example.com:65535/docs', 'https://example.com:65535/docs']
  ])('opens allowlisted URL %s', async (input, expected) => {
    const { adapter, openExternalUrl } = createAdapter()

    await adapter.openURL(input)

    expect(openExternalUrl).toHaveBeenCalledWith(expected)
  })

  it.each([
    { input: 'javascript:alert(1)', label: 'script protocol' },
    { input: 'file:///data/storage/el2/base/files/private', label: 'file protocol' },
    { input: 'mailto:support@example.com', label: 'mail protocol' },
    { input: 'https://user:password@example.com', label: 'embedded credentials' },
    { input: 'https://example.com@evil.test/path', label: 'userinfo bypass' },
    { input: 'https://example.com\\@evil.test/path', label: 'backslash bypass' },
    { input: 'https:///missing-host', label: 'missing host' },
    { input: 'https://:443/path', label: 'empty host' },
    { input: 'https://example.com:65536/path', label: 'out-of-range port' },
    { input: 'https://example.com%40evil.test/path', label: 'encoded userinfo bypass' },
    { input: 'https://example.com/line\nbreak', label: 'control character' },
    { input: `https://example.com/${'x'.repeat(8192)}`, label: 'oversized URL' }
  ])('rejects $label', async ({ input }) => {
    const { adapter, openExternalUrl } = createAdapter()

    await expect(adapter.openURL(input)).rejects.toThrow('Unsupported external URL')
    expect(openExternalUrl).not.toHaveBeenCalled()
  })
})
