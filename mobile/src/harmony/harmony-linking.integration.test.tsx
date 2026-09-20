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
type NotificationResponse = {
  actionIdentifier: string
  notification: {
    request: { content: { data: { hostId: string } }; identifier: string }
  }
}

const dependencies = vi.hoisted(() => {
  const state = {
    conditionalClearAvailable: false,
    initialUrl: null as string | null,
    lastNotificationResponse: null as NotificationResponse | null,
    listeners: new Set<UrlEventListener>(),
    notificationListeners: new Set<(response: NotificationResponse) => void>(),
    onConditionalClear: null as (() => void) | null,
    onNotificationClear: null as (() => void) | null,
    onNotificationSubscribe: null as (() => void) | null
  }
  const removes: ReturnType<typeof vi.fn>[] = []

  const getInitialURL = vi.fn(async () => state.initialUrl)
  const addEventListener = vi.fn((_event: 'url', listener: UrlEventListener) => {
    state.listeners.add(listener)
    const remove = vi.fn(() => state.listeners.delete(listener))
    removes.push(remove)
    return { remove }
  })
  const getLastNotificationResponse = vi.fn(() => state.lastNotificationResponse)
  const clearLastNotificationResponse = vi.fn(() => {
    state.lastNotificationResponse = null
    const onClear = state.onNotificationClear
    state.onNotificationClear = null
    onClear?.()
  })
  const clearLastNotificationResponseIfMatches = vi.fn((identifier: string): boolean | null => {
    if (!state.conditionalClearAvailable) {
      return null
    }
    const onClear = state.onConditionalClear
    state.onConditionalClear = null
    onClear?.()
    if (state.lastNotificationResponse?.notification.request.identifier !== identifier) {
      return false
    }
    state.lastNotificationResponse = null
    return true
  })
  const addNotificationResponseReceivedListener = vi.fn(
    (listener: (response: NotificationResponse) => void) => {
      state.onNotificationSubscribe?.()
      state.notificationListeners.add(listener)
      return { remove: () => state.notificationListeners.delete(listener) }
    }
  )
  const loadHostCatalog = vi.fn(async () => [] as { id: string; credentialStatus: string }[])
  const getNotificationNavigationTarget = vi.fn((data: unknown) => data)
  const openNotificationRoute = vi.fn()

  return {
    addEventListener,
    addNotificationResponseReceivedListener,
    clearLastNotificationResponse,
    clearLastNotificationResponseIfMatches,
    getInitialURL,
    getLastNotificationResponse,
    getNotificationNavigationTarget,
    loadHostCatalog,
    openNotificationRoute,
    removes,
    replace: vi.fn(),
    state,
    emitUrl(url: string) {
      for (const listener of state.listeners) {
        listener({ url })
      }
    },
    emitNotification(response: NotificationResponse) {
      state.lastNotificationResponse = response
      for (const listener of state.notificationListeners) {
        listener(response)
      }
    },
    reset() {
      state.conditionalClearAvailable = false
      state.initialUrl = null
      state.lastNotificationResponse = null
      state.listeners.clear()
      state.notificationListeners.clear()
      state.onConditionalClear = null
      state.onNotificationClear = null
      state.onNotificationSubscribe = null
      removes.length = 0
      addEventListener.mockClear()
      addNotificationResponseReceivedListener.mockClear()
      clearLastNotificationResponse.mockClear()
      clearLastNotificationResponseIfMatches.mockClear()
      getInitialURL.mockClear()
      getLastNotificationResponse.mockClear()
      getNotificationNavigationTarget.mockClear()
      loadHostCatalog.mockReset()
      loadHostCatalog.mockResolvedValue([])
      openNotificationRoute.mockClear()
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
  addNotificationResponseReceivedListener: dependencies.addNotificationResponseReceivedListener,
  clearLastNotificationResponse: dependencies.clearLastNotificationResponse,
  clearLastNotificationResponseIfMatches: dependencies.clearLastNotificationResponseIfMatches,
  getLastNotificationResponse: dependencies.getLastNotificationResponse,
  setNotificationHandler: vi.fn()
}))

vi.mock('expo-splash-screen', () => ({
  hideAsync: vi.fn(async () => true),
  preventAutoHideAsync: vi.fn(async () => true)
}))

vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: () => null }))
vi.mock('../notifications/notification-routing', () => ({
  getNotificationNavigationTarget: dependencies.getNotificationNavigationTarget
}))
vi.mock('../notifications/use-open-notification-route', () => ({
  useOpenNotificationRoute: () => dependencies.openNotificationRoute
}))
vi.mock('../transport/client-context', () => ({
  RpcClientProvider: ({ children }: { children?: React.ReactNode }) => children
}))
vi.mock('../i18n', () => ({
  MobileI18nProvider: ({ children }: { children?: React.ReactNode }) => children
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: dependencies.loadHostCatalog }))
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

  function notification(id: string, hostId: string): NotificationResponse {
    return {
      actionIdentifier: 'default',
      notification: { request: { content: { data: { hostId } }, identifier: id } }
    }
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

  it('reads the latest notification after subscribing so a tap at startup is not lost', async () => {
    dependencies.state.lastNotificationResponse = notification('older', 'old-host')
    dependencies.state.onNotificationSubscribe = () => {
      dependencies.state.lastNotificationResponse = notification('newer', 'new-host')
    }

    await renderRootLayout(() => undefined)

    expect(dependencies.openNotificationRoute).toHaveBeenCalledExactlyOnceWith({
      hostId: 'new-host'
    })
    expect(dependencies.state.lastNotificationResponse).toBeNull()
  })

  it('keeps the newest notification tap when host lookup resolves out of order', async () => {
    let resolveFirst!: (value: []) => void
    let resolveSecond!: (value: []) => void
    dependencies.loadHostCatalog
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
    await renderRootLayout(() => undefined)

    act(() => {
      dependencies.emitNotification(notification('first', 'first-host'))
      dependencies.emitNotification(notification('second', 'second-host'))
    })
    expect(dependencies.clearLastNotificationResponse).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond([])
      await Promise.resolve()
    })
    expect(dependencies.openNotificationRoute).toHaveBeenCalledExactlyOnceWith({
      hostId: 'second-host'
    })

    await act(async () => {
      resolveFirst([])
      await Promise.resolve()
    })
    expect(dependencies.openNotificationRoute).toHaveBeenCalledTimes(1)
  })

  it('keeps a new tap delivered while the earlier response is being cleared', async () => {
    await renderRootLayout(() => undefined)
    dependencies.state.onNotificationClear = () => {
      dependencies.emitNotification(notification('newer', 'new-host'))
    }

    await act(async () => {
      dependencies.emitNotification(notification('older', 'old-host'))
    })

    expect(dependencies.openNotificationRoute).toHaveBeenCalledExactlyOnceWith({
      hostId: 'new-host'
    })
  })

  it('does not clear a newer stored notification when an older event is delivered late', async () => {
    await renderRootLayout(() => undefined)
    dependencies.state.lastNotificationResponse = notification('newer', 'new-host')

    await act(async () => {
      for (const listener of dependencies.state.notificationListeners) {
        listener(notification('older', 'old-host'))
      }
    })

    expect(dependencies.clearLastNotificationResponse).not.toHaveBeenCalled()
    expect(dependencies.state.lastNotificationResponse?.notification.request.identifier).toBe(
      'newer'
    )
  })

  it('uses native compare-and-clear when a newer tap arrives before the clear call', async () => {
    dependencies.state.conditionalClearAvailable = true
    await renderRootLayout(() => undefined)
    dependencies.state.onConditionalClear = () => {
      dependencies.state.lastNotificationResponse = notification('newer', 'new-host')
    }

    await act(async () => {
      dependencies.emitNotification(notification('older', 'old-host'))
    })

    expect(dependencies.clearLastNotificationResponseIfMatches).toHaveBeenCalledExactlyOnceWith(
      'older'
    )
    expect(dependencies.clearLastNotificationResponse).not.toHaveBeenCalled()
    expect(dependencies.state.lastNotificationResponse?.notification.request.identifier).toBe(
      'newer'
    )
  })

  it('does not navigate after the notification layout unmounts during host lookup', async () => {
    let resolveCatalog!: (value: []) => void
    dependencies.loadHostCatalog.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCatalog = resolve))
    )
    await renderRootLayout(() => undefined)

    act(() => dependencies.emitNotification(notification('pending', 'pending-host')))
    act(() => renderer?.unmount())
    renderer = null

    await act(async () => {
      resolveCatalog([])
      await Promise.resolve()
    })
    expect(dependencies.openNotificationRoute).not.toHaveBeenCalled()
  })
})
