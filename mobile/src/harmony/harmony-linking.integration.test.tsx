import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RootLayout from '../../app/_layout'
import {
  HarmonyRouterProvider,
  useLocalSearchParams,
  usePathname
} from '../../harmony/src/navigation/harmony-router'

type UrlEventListener = (event: { url: string }) => void

const dependencies = vi.hoisted(() => {
  const state = { initialUrl: null as string | null, listeners: new Set<UrlEventListener>() }
  const removes: ReturnType<typeof vi.fn>[] = []

  const getInitialURL = vi.fn(async () => state.initialUrl)
  const addEventListener = vi.fn((_event: 'url', listener: UrlEventListener) => {
    state.listeners.add(listener)
    const remove = vi.fn(() => state.listeners.delete(listener))
    removes.push(remove)
    return { remove }
  })

  return {
    addEventListener,
    getInitialURL,
    removes,
    replace: vi.fn(),
    state,
    emitUrl(url: string) {
      for (const listener of state.listeners) {
        listener({ url })
      }
    },
    reset() {
      state.initialUrl = null
      state.listeners.clear()
      removes.length = 0
      addEventListener.mockClear()
      getInitialURL.mockClear()
    }
  }
})

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'View'
}))

vi.mock('../../harmony/node_modules/react-native/index.js', () => ({
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'View'
}))

vi.mock('../../harmony/node_modules/react/index.js', async () => {
  return vi.importActual<typeof import('react')>('react')
})

vi.mock('expo-linking', () => ({
  addEventListener: dependencies.addEventListener,
  getInitialURL: dependencies.getInitialURL
}))

vi.mock('expo-router', async () =>
  vi.importActual<typeof import('../../harmony/src/navigation/harmony-router')>(
    '../../harmony/src/navigation/harmony-router'
  )
)

vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  clearLastNotificationResponse: vi.fn(),
  getLastNotificationResponse: vi.fn(() => null),
  setNotificationHandler: vi.fn()
}))

vi.mock('expo-splash-screen', () => ({
  hideAsync: vi.fn(async () => true),
  preventAutoHideAsync: vi.fn(async () => true)
}))

vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: () => null }))
vi.mock('../notifications/notification-routing', () => ({
  getNotificationNavigationTarget: vi.fn()
}))
vi.mock('../notifications/use-open-notification-route', () => ({
  useOpenNotificationRoute: () => vi.fn()
}))
vi.mock('../transport/client-context', () => ({
  RpcClientProvider: ({ children }: { children?: React.ReactNode }) => children
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: vi.fn() }))
vi.mock('../transport/mobile-relay-pairing-recovery', () => ({
  recoverMobileRelayPairing: vi.fn(async () => undefined)
}))

vi.mock('../../harmony/src/navigation/harmony-route-registry', () => ({
  matchHostRoute: vi.fn(() => null),
  matchRootRoute: vi.fn(() => ({ component: () => null, params: {} }))
}))

describe('Harmony/Expo RootLayout linking', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    dependencies.reset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function RouteProbe({
    onRoute
  }: {
    onRoute: (route: { pathname: string; code?: string }) => void
  }) {
    const pathname = usePathname()
    const params = useLocalSearchParams<{ code?: string }>()
    onRoute({ pathname, code: params.code })
    return null
  }

  async function renderRootLayout(onRoute: (route: { pathname: string; code?: string }) => void) {
    await act(async () => {
      renderer = create(
        createElement(
          HarmonyRouterProvider,
          null,
          createElement(RootLayout),
          createElement(RouteProbe, { onRoute })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('routes a valid cold-start initial URL to pair confirmation', async () => {
    dependencies.state.initialUrl = 'orca://pair?code=cold-start-code'
    let route = { pathname: '', code: undefined as string | undefined }

    await renderRootLayout((nextRoute) => {
      route = nextRoute
    })

    expect(route).toEqual({ pathname: '/pair-confirm', code: 'cold-start-code' })
    expect(dependencies.getInitialURL).toHaveBeenCalledOnce()
  })

  it('routes valid warm-start URL events, ignores invalid URLs, and removes the listener on unmount', async () => {
    let route = { pathname: '', code: undefined as string | undefined }
    await renderRootLayout((nextRoute) => {
      route = nextRoute
    })

    await act(async () => {
      dependencies.emitUrl('orca://pair?code=warm-start-code')
    })
    expect(route).toEqual({ pathname: '/pair-confirm', code: 'warm-start-code' })

    await act(async () => {
      dependencies.emitUrl('orca://pairing?code=not-a-pair-route')
      dependencies.emitUrl('https://example.com/pair?code=also-invalid')
    })
    expect(route).toEqual({ pathname: '/pair-confirm', code: 'warm-start-code' })

    const remove = dependencies.removes.at(-1)
    expect(remove).toBeDefined()
    act(() => renderer?.unmount())
    renderer = null
    expect(remove).toHaveBeenCalledOnce()

    await act(async () => {
      dependencies.emitUrl('orca://pair?code=after-unmount')
    })
    expect(route).toEqual({ pathname: '/pair-confirm', code: 'warm-start-code' })
  })
})
