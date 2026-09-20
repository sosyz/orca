import i18next, { type i18n as I18nInstance, type TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en'
import zh from './locales/zh'
import { getMobileSystemLocale } from './mobile-system-locale'
import {
  resolveMobileUiLocale,
  type MobileSupportedUiLocale,
  type MobileUiLanguage
} from './supported-languages'
import { UI_LANGUAGE_ENGLISH } from '../../../src/shared/ui-language'

export const i18n: I18nInstance = i18next.createInstance()

void i18n.use(initReactI18next).init({
  fallbackLng: UI_LANGUAGE_ENGLISH,
  lng: UI_LANGUAGE_ENGLISH,
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  }
})

export function translateMobile(key: string, fallback: string, options?: TOptions): string {
  return i18n.t(key, { defaultValue: fallback, ...options })
}

export async function changeMobileUiLanguage(
  language: MobileUiLanguage,
  systemLocale: string = getMobileSystemLocale()
): Promise<MobileSupportedUiLocale> {
  const locale = resolveMobileUiLocale(language, systemLocale)
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale)
  }
  return locale
}
