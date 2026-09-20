import { NativeModules, Platform, TurboModuleRegistry } from 'react-native'
import type { TurboModule } from 'react-native'

import { DEFAULT_UI_LOCALE } from '../../../src/shared/ui-locale'

type SystemLocaleNativeModule = TurboModule & {
  getSystemLocale?: () => string | null
}

let harmonyNativeModule: SystemLocaleNativeModule | null | undefined

function readHarmonyNativeModule(): SystemLocaleNativeModule | null {
  if ((Platform.OS as string) !== 'harmony') {
    return null
  }
  if (harmonyNativeModule !== undefined) {
    return harmonyNativeModule
  }
  try {
    harmonyNativeModule =
      TurboModuleRegistry.get<SystemLocaleNativeModule>('OrcaHarmony') ??
      ((NativeModules.OrcaHarmony as SystemLocaleNativeModule | undefined) || null)
  } catch {
    harmonyNativeModule = null
  }
  return harmonyNativeModule
}

function readHarmonySystemLocale(): string | null {
  const nativeModule = readHarmonyNativeModule()
  try {
    const locale = nativeModule?.getSystemLocale?.()
    return typeof locale === 'string' && locale.trim().length > 0 ? locale : null
  } catch {
    return null
  }
}

function readReactNativeSystemLocale(): string | null {
  const settings = (
    NativeModules.SettingsManager as
      | { settings?: { AppleLanguages?: unknown; AppleLocale?: unknown } }
      | undefined
  )?.settings
  if (Array.isArray(settings?.AppleLanguages)) {
    const locale = settings.AppleLanguages.find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
    if (locale) {
      return locale
    }
  }
  if (typeof settings?.AppleLocale === 'string' && settings.AppleLocale.trim().length > 0) {
    return settings.AppleLocale
  }

  const i18nManager = NativeModules.I18nManager as
    | { localeIdentifier?: unknown; locale?: unknown }
    | undefined
  if (
    typeof i18nManager?.localeIdentifier === 'string' &&
    i18nManager.localeIdentifier.trim().length > 0
  ) {
    return i18nManager.localeIdentifier
  }
  if (typeof i18nManager?.locale === 'string' && i18nManager.locale.trim().length > 0) {
    return i18nManager.locale
  }

  const platformConstants = NativeModules.PlatformConstants as
    | { localeIdentifier?: unknown; systemLocale?: unknown }
    | undefined
  if (
    typeof platformConstants?.localeIdentifier === 'string' &&
    platformConstants.localeIdentifier.trim().length > 0
  ) {
    return platformConstants.localeIdentifier
  }
  if (
    typeof platformConstants?.systemLocale === 'string' &&
    platformConstants.systemLocale.trim().length > 0
  ) {
    return platformConstants.systemLocale
  }
  return null
}

function readIntlSystemLocale(): string | null {
  try {
    const locale = globalThis.Intl?.DateTimeFormat().resolvedOptions().locale
    return typeof locale === 'string' && locale.trim().length > 0 ? locale : null
  } catch {
    return null
  }
}

function readJavaScriptSystemLocale(): string | null {
  const navigatorLike = globalThis.navigator as
    | { language?: string; languages?: readonly string[] }
    | undefined
  const locale = navigatorLike?.languages?.[0] ?? navigatorLike?.language
  return typeof locale === 'string' && locale.trim().length > 0 ? locale : null
}

export function getMobileSystemLocale(): string {
  return (
    readHarmonySystemLocale() ??
    readReactNativeSystemLocale() ??
    readIntlSystemLocale() ??
    readJavaScriptSystemLocale() ??
    DEFAULT_UI_LOCALE
  )
}
