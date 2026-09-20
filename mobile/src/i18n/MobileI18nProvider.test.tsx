import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UI_LANGUAGE_CHINESE, UI_LANGUAGE_ENGLISH } from '../../../src/shared/ui-language'
import { MobileI18nProvider, useMobileI18n } from './MobileI18nProvider'

type Deferred<T> = {
  promise: Promise<T>
  reject: (error: Error) => void
  resolve: (value: T) => void
}

type LanguageCall = Deferred<string> & {
  language: string
  systemLocale: string
}

function deferred<T>(): Deferred<T> {
  let reject!: (error: Error) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const providerMocks = vi.hoisted(() => {
  function deferred<T>(): Deferred<T> {
    let reject!: (error: Error) => void
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, reject, resolve }
  }

  const languageCalls: LanguageCall[] = []
  const appStateListeners: Array<(state: string) => void> = []
  const nativeModules = {
    SettingsManager: { settings: { AppleLocale: 'en-US' } }
  } as Record<string, unknown>
  const platform = { OS: 'ios' }
  const changeMobileUiLanguage = vi.fn((language: string, systemLocale: string) => {
    const call = { ...deferred<string>(), language, systemLocale }
    languageCalls.push(call)
    return call.promise
  })

  return {
    appStateListeners,
    changeMobileUiLanguage,
    languageCalls,
    nativeModules,
    platform
  }
})

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn()
  }
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn((_eventName, listener) => {
      providerMocks.appStateListeners.push(listener)
      return { remove: vi.fn() }
    })
  },
  NativeModules: providerMocks.nativeModules,
  Platform: providerMocks.platform,
  TurboModuleRegistry: { get: vi.fn(() => null) }
}))

vi.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: unknown }) => children,
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock('./i18n', () => ({
  changeMobileUiLanguage: providerMocks.changeMobileUiLanguage,
  i18n: { language: 'en' }
}))

type MobileI18nHook = ReturnType<typeof useMobileI18n>

let latestContext: MobileI18nHook | null = null

function Probe() {
  latestContext = useMobileI18n()
  return null
}

async function renderProvider(): Promise<ReactTestRenderer> {
  latestContext = null
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <MobileI18nProvider>
        <Probe />
      </MobileI18nProvider>
    )
    await Promise.resolve()
  })
  return renderer
}

async function settleLanguageCall(index: number, resolvedLocale: string): Promise<void> {
  const call = providerMocks.languageCalls[index]
  await act(async () => {
    call.resolve(resolvedLocale)
    await call.promise
    await Promise.resolve()
  })
}

async function hydrate(initialLanguage: string | null = null): Promise<ReactTestRenderer> {
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(initialLanguage)
  const renderer = await renderProvider()
  expect(providerMocks.languageCalls).toHaveLength(1)
  await settleLanguageCall(0, initialLanguage === UI_LANGUAGE_CHINESE ? 'zh' : 'en')
  expect(latestContext?.hydrated).toBe(true)
  return renderer
}

beforeEach(() => {
  latestContext = null
  providerMocks.appStateListeners.length = 0
  providerMocks.languageCalls.length = 0
  providerMocks.changeMobileUiLanguage.mockClear()
  providerMocks.nativeModules.SettingsManager = { settings: { AppleLocale: 'en-US' } }
  delete providerMocks.nativeModules.I18nManager
  delete providerMocks.nativeModules.PlatformConstants
  providerMocks.platform.OS = 'ios'
  vi.mocked(AsyncStorage.getItem).mockReset()
  vi.mocked(AsyncStorage.setItem).mockReset()
  vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
})

describe('MobileI18nProvider', () => {
  it('does not let AppState hydrate before the stored preference finishes loading', async () => {
    const preference = deferred<string | null>()
    vi.mocked(AsyncStorage.getItem).mockImplementation(() => preference.promise)
    await renderProvider()

    await act(async () => {
      providerMocks.appStateListeners.forEach((listener) => listener('active'))
      await Promise.resolve()
    })

    expect(latestContext).toBeNull()
    expect(providerMocks.languageCalls).toHaveLength(0)

    await act(async () => {
      preference.resolve(UI_LANGUAGE_CHINESE)
      await preference.promise
      await Promise.resolve()
    })
    expect(providerMocks.languageCalls).toHaveLength(1)

    await settleLanguageCall(0, 'zh')

    expect(latestContext?.hydrated).toBe(true)
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_CHINESE)
    expect(latestContext?.resolvedLocale).toBe('zh')
  })

  it('hydrates through the system fallback when preference storage fails', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'))
    await renderProvider()
    expect(providerMocks.languageCalls).toHaveLength(1)

    await settleLanguageCall(0, 'en')

    expect(latestContext?.hydrated).toBe(true)
    expect(latestContext?.languagePersistenceStatus).toBe('read-failed')
    expect(latestContext?.uiLanguage).toBe('system')
    expect(latestContext?.resolvedLocale).toBe('en')
  })

  it('keeps the manual language visible when persistence fails', async () => {
    await hydrate()
    vi.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('storage unavailable'))

    let selection!: Promise<void>
    await act(async () => {
      selection = latestContext!.setUiLanguage(UI_LANGUAGE_CHINESE)
      await Promise.resolve()
    })
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_CHINESE)
    expect(providerMocks.languageCalls).toHaveLength(2)

    await settleLanguageCall(1, 'zh')
    await selection

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('orca:uiLanguage', UI_LANGUAGE_CHINESE)
    expect(latestContext?.languagePersistenceStatus).toBe('write-failed')
    expect(latestContext?.resolvedLocale).toBe('zh')
  })

  it('does not let a stale AppState system refresh override a fast manual choice', async () => {
    await hydrate()
    providerMocks.nativeModules.SettingsManager = { settings: { AppleLocale: 'zh-Hans-CN' } }

    await act(async () => {
      providerMocks.appStateListeners.forEach((listener) => listener('active'))
      await Promise.resolve()
    })
    expect(providerMocks.languageCalls).toHaveLength(2)
    expect(providerMocks.languageCalls[1].language).toBe('system')
    expect(providerMocks.languageCalls[1].systemLocale).toBe('zh-Hans-CN')

    let selection!: Promise<void>
    await act(async () => {
      selection = latestContext!.setUiLanguage(UI_LANGUAGE_ENGLISH)
      providerMocks.appStateListeners.forEach((listener) => listener('active'))
      await Promise.resolve()
    })
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_ENGLISH)
    expect(latestContext?.resolvedLocale).toBe('en')
    expect(providerMocks.languageCalls).toHaveLength(2)

    await settleLanguageCall(1, 'zh')
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_ENGLISH)
    expect(latestContext?.resolvedLocale).toBe('en')
    expect(providerMocks.languageCalls).toHaveLength(3)

    await settleLanguageCall(2, 'en')
    await selection

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('orca:uiLanguage', UI_LANGUAGE_ENGLISH)
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_ENGLISH)
    expect(latestContext?.resolvedLocale).toBe('en')
  })

  it('hydrates a remount from the latest language while the prior provider write is pending', async () => {
    const first = await hydrate()
    const pendingWrite = deferred<void>()
    let stored: string | null = null
    vi.mocked(AsyncStorage.getItem).mockImplementation(async () => stored)
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (_key, value) => {
      await pendingWrite.promise
      stored = value
    })

    let selection!: Promise<void>
    await act(async () => {
      selection = latestContext!.setUiLanguage(UI_LANGUAGE_CHINESE)
      await Promise.resolve()
    })
    await settleLanguageCall(1, 'zh')
    await vi.waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledOnce())
    act(() => first.unmount())

    const second = await renderProvider()
    expect(providerMocks.languageCalls).toHaveLength(2)
    await act(async () => {
      pendingWrite.resolve()
      await selection
      await Promise.resolve()
    })
    expect(providerMocks.languageCalls).toHaveLength(3)
    expect(providerMocks.languageCalls[2].language).toBe(UI_LANGUAGE_CHINESE)
    await settleLanguageCall(2, 'zh')
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_CHINESE)
    act(() => second.unmount())
  })

  it('persists only the latest choice when languages change during an earlier apply', async () => {
    const renderer = await hydrate()
    let older!: Promise<void>
    let newer!: Promise<void>
    await act(async () => {
      older = latestContext!.setUiLanguage(UI_LANGUAGE_CHINESE)
      await Promise.resolve()
    })
    expect(providerMocks.languageCalls[1].language).toBe(UI_LANGUAGE_CHINESE)
    await act(async () => {
      newer = latestContext!.setUiLanguage(UI_LANGUAGE_ENGLISH)
      await Promise.resolve()
    })
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_ENGLISH)

    await settleLanguageCall(1, 'zh')
    expect(providerMocks.languageCalls[2].language).toBe(UI_LANGUAGE_ENGLISH)
    await settleLanguageCall(2, 'en')
    await Promise.all([older, newer])

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('orca:uiLanguage', UI_LANGUAGE_ENGLISH)
    expect(latestContext?.uiLanguage).toBe(UI_LANGUAGE_ENGLISH)
    act(() => renderer.unmount())
  })
})
