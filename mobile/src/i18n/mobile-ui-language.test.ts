import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  UI_LANGUAGE_CHINESE,
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_SYSTEM
} from '../../../src/shared/ui-language'
import {
  normalizeMobileUiLanguage,
  resolveMobileUiLocale,
  MOBILE_LANGUAGE_OPTIONS
} from './supported-languages'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('react-native')
  vi.unstubAllGlobals()
})

describe('mobile UI language support', () => {
  it('reuses shared UI language ids while keeping the mobile option set small', () => {
    expect(MOBILE_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([
      UI_LANGUAGE_SYSTEM,
      UI_LANGUAGE_ENGLISH,
      UI_LANGUAGE_CHINESE
    ])
    expect(normalizeMobileUiLanguage('fr')).toBe(UI_LANGUAGE_SYSTEM)
  })

  it('resolves system locale to the supported mobile catalog', () => {
    expect(resolveMobileUiLocale(UI_LANGUAGE_SYSTEM, 'zh-Hans-CN')).toBe('zh')
    expect(resolveMobileUiLocale(UI_LANGUAGE_SYSTEM, 'zh-CN')).toBe('zh')
    expect(resolveMobileUiLocale(UI_LANGUAGE_SYSTEM, 'zh-TW')).toBe('en')
    expect(resolveMobileUiLocale(UI_LANGUAGE_SYSTEM, 'fr-FR')).toBe('en')
    expect(resolveMobileUiLocale(UI_LANGUAGE_CHINESE, 'en-US')).toBe('zh')
    expect(resolveMobileUiLocale(UI_LANGUAGE_ENGLISH, 'zh-CN')).toBe('en')
  })

  it('changes local i18next resources without requiring Intl plural rules', async () => {
    vi.stubGlobal('Intl', undefined)
    vi.doMock('react-native', () => ({
      NativeModules: {
        SettingsManager: { settings: { AppleLocale: 'en-US' } }
      },
      Platform: { OS: 'ios' },
      TurboModuleRegistry: { get: vi.fn(() => null) }
    }))
    const { changeMobileUiLanguage, i18n, translateMobile } = await import('./i18n')

    await changeMobileUiLanguage(UI_LANGUAGE_CHINESE, 'en-US')
    expect(i18n.language).toBe('zh')
    expect(translateMobile('mobile.home.empty.title', 'fallback')).toBe('连接你的桌面端')

    await changeMobileUiLanguage(UI_LANGUAGE_SYSTEM, 'en-US')
    expect(i18n.language).toBe('en')
    expect(translateMobile('mobile.home.empty.title', 'fallback')).toBe('Connect your desktop')
  })

  it('loads session strings in both mobile catalogs', async () => {
    vi.doMock('react-native', () => ({
      NativeModules: {
        SettingsManager: { settings: { AppleLocale: 'en-US' } }
      },
      Platform: { OS: 'ios' },
      TurboModuleRegistry: { get: vi.fn(() => null) }
    }))
    const { changeMobileUiLanguage, translateMobile } = await import('./i18n')

    await changeMobileUiLanguage(UI_LANGUAGE_CHINESE, 'en-US')
    expect(translateMobile('mobile.session.terminalInput.status.liveTitle', 'fallback')).toBe(
      '实时输入'
    )
    expect(
      translateMobile('mobile.session.reviewNotes.summaryMany', 'fallback', { count: 2 })
    ).toBe('2 条审阅备注')

    await changeMobileUiLanguage(UI_LANGUAGE_ENGLISH, 'zh-CN')
    expect(translateMobile('mobile.session.terminalInput.status.liveTitle', 'fallback')).toBe(
      'Live input'
    )
    expect(translateMobile('mobile.session.reviewNotes.summaryOne', 'fallback', { count: 1 })).toBe(
      '1 review note'
    )
  })
})
