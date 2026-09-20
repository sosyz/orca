import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { I18nextProvider, useTranslation } from 'react-i18next'

import { changeMobileUiLanguage, i18n } from './i18n'
import { getMobileSystemLocale } from './mobile-system-locale'
import {
  normalizeMobileUiLanguage,
  resolveMobileUiLocale,
  type MobileSupportedUiLocale,
  type MobileUiLanguage
} from './supported-languages'
import { UI_LANGUAGE_SYSTEM } from '../../../src/shared/ui-language'
import { readMobileUiLanguagePreference, saveMobileUiLanguage } from '../storage/preferences'

export type MobileLanguagePersistenceStatus = 'ok' | 'read-failed' | 'write-failed'

type MobileI18nState = {
  hydrated: boolean
  languagePersistenceStatus: MobileLanguagePersistenceStatus
  resolvedLocale: MobileSupportedUiLocale
  systemLocale: string
  uiLanguage: MobileUiLanguage
}

type MobileI18nContextValue = MobileI18nState & {
  setUiLanguage: (language: MobileUiLanguage) => Promise<void>
}

const DEFAULT_STATE: MobileI18nState = {
  hydrated: false,
  languagePersistenceStatus: 'ok',
  resolvedLocale: 'en',
  systemLocale: 'en',
  uiLanguage: UI_LANGUAGE_SYSTEM
}

const MobileI18nContext = createContext<MobileI18nContextValue | null>(null)

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MobileI18nState>(DEFAULT_STATE)
  const stateRef = useRef(state)
  const requestIdRef = useRef(0)
  const applyTailRef = useRef(Promise.resolve())

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const commitState = useCallback((nextState: MobileI18nState): void => {
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const enqueueLanguageRequest = useCallback(
    (
      language: MobileUiLanguage,
      options: {
        optimistic?: boolean
        persist: boolean
        persistenceStatus?: MobileLanguagePersistenceStatus
      }
    ): Promise<void> => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const uiLanguage = normalizeMobileUiLanguage(language)
      const systemLocale = getMobileSystemLocale()
      const resolvedLocale = resolveMobileUiLocale(uiLanguage, systemLocale)
      const optimisticState: MobileI18nState = {
        hydrated: true,
        languagePersistenceStatus: options.persistenceStatus ?? 'ok',
        resolvedLocale,
        systemLocale,
        uiLanguage
      }

      if (options.optimistic) {
        commitState(optimisticState)
      }

      const run = async (): Promise<void> => {
        if (requestId !== requestIdRef.current) {
          return
        }
        let effectiveResolvedLocale = resolvedLocale
        try {
          await changeMobileUiLanguage(uiLanguage, systemLocale)
        } catch {
          effectiveResolvedLocale = await changeMobileUiLanguage(UI_LANGUAGE_SYSTEM, 'en').catch(
            () => 'en'
          )
        }
        if (requestId !== requestIdRef.current) {
          return
        }
        let languagePersistenceStatus = options.persistenceStatus ?? 'ok'
        if (options.persist) {
          try {
            await saveMobileUiLanguage(uiLanguage)
          } catch {
            languagePersistenceStatus = 'write-failed'
          }
        }
        if (requestId === requestIdRef.current) {
          commitState({
            hydrated: true,
            languagePersistenceStatus,
            resolvedLocale: effectiveResolvedLocale,
            systemLocale,
            uiLanguage
          })
        }
      }

      const nextTail = applyTailRef.current.then(run, run)
      applyTailRef.current = nextTail.catch(() => undefined)
      return nextTail
    },
    [commitState]
  )

  useEffect(() => {
    let mounted = true
    const hydrationOwnerId = requestIdRef.current
    void readMobileUiLanguagePreference()
      .catch(() => ({
        loaded: false,
        value: normalizeMobileUiLanguage(UI_LANGUAGE_SYSTEM)
      }))
      .then((preference) => {
        if (!mounted || hydrationOwnerId !== requestIdRef.current) {
          return
        }
        void enqueueLanguageRequest(preference.value, {
          persist: false,
          persistenceStatus: preference.loaded ? 'ok' : 'read-failed'
        })
      })
    return () => {
      mounted = false
      requestIdRef.current += 1
    }
  }, [enqueueLanguageRequest])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (
        appState !== 'active' ||
        !stateRef.current.hydrated ||
        stateRef.current.uiLanguage !== UI_LANGUAGE_SYSTEM
      ) {
        return
      }
      const systemLocale = getMobileSystemLocale()
      const resolvedLocale = resolveMobileUiLocale(UI_LANGUAGE_SYSTEM, systemLocale)
      if (
        systemLocale === stateRef.current.systemLocale &&
        resolvedLocale === stateRef.current.resolvedLocale
      ) {
        return
      }
      void enqueueLanguageRequest(UI_LANGUAGE_SYSTEM, {
        persist: false,
        persistenceStatus: stateRef.current.languagePersistenceStatus
      })
    })
    return () => subscription.remove()
  }, [enqueueLanguageRequest])

  const value = useMemo<MobileI18nContextValue>(
    () => ({
      ...state,
      setUiLanguage: (language) =>
        enqueueLanguageRequest(language, {
          optimistic: true,
          persist: true
        })
    }),
    [enqueueLanguageRequest, state]
  )

  return (
    <I18nextProvider i18n={i18n}>
      <MobileI18nContext.Provider value={value}>
        {state.hydrated ? children : null}
      </MobileI18nContext.Provider>
    </I18nextProvider>
  )
}

export function useMobileI18n() {
  const context = useContext(MobileI18nContext)
  const translation = useTranslation()
  if (!context) {
    throw new Error('useMobileI18n must be used inside MobileI18nProvider')
  }
  return { ...context, ...translation }
}
