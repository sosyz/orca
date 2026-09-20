import { afterEach, describe, expect, it, vi } from 'vitest'

type ReactNativeMock = {
  NativeModules: Record<string, unknown>
  Platform: { OS: string }
  TurboModuleRegistry: { get: ReturnType<typeof vi.fn> }
}

function reactNativeMock({
  nativeModules = {},
  platform = 'ios',
  turboModule
}: {
  nativeModules?: Record<string, unknown>
  platform?: string
  turboModule?: unknown
} = {}): ReactNativeMock {
  return {
    NativeModules: nativeModules,
    Platform: { OS: platform },
    TurboModuleRegistry: {
      get: vi.fn(() => turboModule ?? null)
    }
  }
}

async function loadLocaleReader(mock: ReactNativeMock) {
  vi.resetModules()
  vi.doMock('react-native', () => mock)
  return import('./mobile-system-locale')
}

afterEach(() => {
  vi.doUnmock('react-native')
  vi.unstubAllGlobals()
})

describe('mobile system locale detection', () => {
  it('uses Harmony native locale even when Intl is unavailable', async () => {
    vi.stubGlobal('Intl', undefined)
    const nativeModule = { getSystemLocale: vi.fn(() => 'zh-Hans-CN') }
    const { getMobileSystemLocale } = await loadLocaleReader(
      reactNativeMock({ platform: 'harmony', turboModule: nativeModule })
    )

    expect(getMobileSystemLocale()).toBe('zh-Hans-CN')
    expect(nativeModule.getSystemLocale).toHaveBeenCalledTimes(1)
  })

  it('falls back safely when the Harmony locale capability is missing', async () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat: vi.fn(() => ({ resolvedOptions: () => ({ locale: 'zh-Hans-CN' }) }))
    })
    const { getMobileSystemLocale } = await loadLocaleReader(
      reactNativeMock({ platform: 'harmony', turboModule: { getSystemLocale: () => null } })
    )
    expect(getMobileSystemLocale()).toBe('zh-Hans-CN')

    vi.stubGlobal('Intl', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(getMobileSystemLocale()).toBe('en')
  })

  it('reads the iOS locale from SettingsManager', async () => {
    vi.stubGlobal('Intl', undefined)
    const { getMobileSystemLocale } = await loadLocaleReader(
      reactNativeMock({
        nativeModules: {
          SettingsManager: { settings: { AppleLanguages: ['zh-Hans-CN'] } }
        },
        platform: 'ios'
      })
    )

    expect(getMobileSystemLocale()).toBe('zh-Hans-CN')
  })

  it('prefers the iOS language choice over a different regional locale', async () => {
    vi.stubGlobal('Intl', undefined)
    const { getMobileSystemLocale } = await loadLocaleReader(
      reactNativeMock({
        nativeModules: {
          SettingsManager: {
            settings: { AppleLanguages: ['zh-Hans-CN'], AppleLocale: 'en_US' }
          }
        },
        platform: 'ios'
      })
    )

    expect(getMobileSystemLocale()).toBe('zh-Hans-CN')
  })

  it('reads the Android locale from React Native native modules', async () => {
    vi.stubGlobal('Intl', undefined)
    const { getMobileSystemLocale } = await loadLocaleReader(
      reactNativeMock({
        nativeModules: {
          I18nManager: { localeIdentifier: 'pt_BR' },
          PlatformConstants: { systemLocale: 'fr-FR' }
        },
        platform: 'android'
      })
    )

    expect(getMobileSystemLocale()).toBe('pt_BR')
  })

  it('falls back through Intl and finally the shared default locale', async () => {
    const { getMobileSystemLocale } = await loadLocaleReader(reactNativeMock())

    vi.stubGlobal('Intl', {
      DateTimeFormat: vi.fn(() => ({
        resolvedOptions: () => ({ locale: 'fr-FR' })
      }))
    })
    expect(getMobileSystemLocale()).toBe('fr-FR')

    vi.stubGlobal('Intl', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(getMobileSystemLocale()).toBe('en')
  })
})
