import {
  UI_LANGUAGE_CHINESE,
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_SYSTEM,
  type UiLanguage
} from '../../../src/shared/ui-language'
import { resolveUiLocale } from '../../../src/shared/ui-locale'

export const MOBILE_SUPPORTED_LOCALES = [UI_LANGUAGE_ENGLISH, UI_LANGUAGE_CHINESE] as const
export type MobileSupportedUiLocale = (typeof MOBILE_SUPPORTED_LOCALES)[number]

export const MOBILE_UI_LANGUAGE_VALUES = [
  UI_LANGUAGE_SYSTEM,
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_CHINESE
] as const
export type MobileUiLanguage = (typeof MOBILE_UI_LANGUAGE_VALUES)[number]

export const MOBILE_LANGUAGE_OPTIONS = [
  {
    value: UI_LANGUAGE_SYSTEM,
    labelKey: 'settings.appearance.language.system',
    fallback: 'System'
  },
  {
    value: UI_LANGUAGE_ENGLISH,
    labelKey: 'settings.appearance.language.english',
    fallback: 'English'
  },
  {
    value: UI_LANGUAGE_CHINESE,
    labelKey: 'settings.appearance.language.chinese',
    fallback: 'Simplified Chinese'
  }
] as const

const MOBILE_UI_LANGUAGE_SET = new Set<MobileUiLanguage>(MOBILE_UI_LANGUAGE_VALUES)

export function isMobileUiLanguage(value: unknown): value is MobileUiLanguage {
  return MOBILE_UI_LANGUAGE_SET.has(value as MobileUiLanguage)
}

export function normalizeMobileUiLanguage(value: unknown): MobileUiLanguage {
  return isMobileUiLanguage(value) ? value : UI_LANGUAGE_SYSTEM
}

export function resolveMobileUiLocale(
  language: UiLanguage,
  systemLocale: string | undefined
): MobileSupportedUiLocale {
  const resolved = resolveUiLocale(language, systemLocale)
  return resolved === UI_LANGUAGE_CHINESE ? UI_LANGUAGE_CHINESE : UI_LANGUAGE_ENGLISH
}
