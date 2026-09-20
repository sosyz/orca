import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from 'react'
import { BackHandler } from 'react-native'

import { matchHostRoute, matchRootRoute } from './harmony-route-registry'
import {
  backHarmonyHistoryEntry,
  createHarmonyHistoryEntry,
  createHarmonyNavigationState,
  dismissToHarmonyHistoryEntry,
  getHarmonyRouteParams,
  pushHarmonyHistoryEntry,
  replaceHarmonyHistoryEntry,
  replaceHarmonyHostStackRoute,
  setHarmonyHistoryParams,
  type HarmonyHistoryEntry,
  type HarmonyHostStackReplaceAction,
  type HarmonyNavigationState,
  type HarmonyRouteKeyFactory
} from './harmony-navigation-history'
import type { HarmonyHref as Href, HarmonyRouteParams as RouteParams } from './harmony-route-state'

type RouterApi = {
  back(): void
  canGoBack(): boolean
  dismissTo(href: Href): void
  push(href: Href): void
  replace(href: Href): void
  setParams(params: RouteParams): void
}

type NavigationListener = () => void
type NavigationEvent = 'state'
type RouteBackHandler = () => boolean

export function shouldDeferHarmonyBackPressToRoute(pathname: string): boolean {
  return pathname === '/mobile-onboarding' || /^\/h\/[^/]+\/session\/[^/]+$/.test(pathname)
}

const RouterContext = createContext<{
  navigation: ReturnType<typeof createNavigationApi>
  router: RouterApi
  route: HarmonyHistoryEntry
} | null>(null)
const LayoutDepthContext = createContext(0)

function createNavigationApi(
  historyRef: RefObject<readonly HarmonyHistoryEntry[]>,
  listeners: Record<NavigationEvent, Set<NavigationListener>>,
  routeBackHandlersRef: RefObject<Map<string, Set<RouteBackHandler>>>,
  createKey: HarmonyRouteKeyFactory,
  setHistory: Dispatch<SetStateAction<HarmonyHistoryEntry[]>>
) {
  return {
    addListener: (event: NavigationEvent, listener: NavigationListener) => {
      listeners[event].add(listener)
      return () => listeners[event].delete(listener)
    },
    dispatch: (action: HarmonyHostStackReplaceAction) =>
      setHistory((current) => replaceHarmonyHostStackRoute(current, action, createKey)),
    getState: (): HarmonyNavigationState => createHarmonyNavigationState(historyRef.current),
    isFocused: () => true,
    registerBackHandler: (handler: RouteBackHandler) => {
      const routeKey = historyRef.current.at(-1)?.key
      if (!routeKey) {
        return () => {}
      }
      const handlers = routeBackHandlersRef.current.get(routeKey) ?? new Set<RouteBackHandler>()
      handlers.add(handler)
      routeBackHandlersRef.current.set(routeKey, handlers)
      return () => {
        const currentHandlers = routeBackHandlersRef.current.get(routeKey)
        currentHandlers?.delete(handler)
        if (currentHandlers?.size === 0) {
          routeBackHandlersRef.current.delete(routeKey)
        }
      }
    }
  }
}

export function HarmonyRouterProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const keySeqRef = useRef(0)
  const createKey = useCallback<HarmonyRouteKeyFactory>((name) => {
    keySeqRef.current += 1
    return `harmony:${name}:${keySeqRef.current}`
  }, [])
  const [history, setHistory] = useState<HarmonyHistoryEntry[]>(() => [
    createHarmonyHistoryEntry('/', null, createKey)
  ])
  const route = history[history.length - 1]
  const historyRef = useRef<readonly HarmonyHistoryEntry[]>(history)
  historyRef.current = history
  const historyLengthRef = useRef(history.length)
  historyLengthRef.current = history.length
  const listenersRef = useRef<Record<NavigationEvent, Set<NavigationListener>>>({
    state: new Set()
  })
  const routeBackHandlersRef = useRef<Map<string, Set<RouteBackHandler>>>(new Map())

  const commit = useCallback(
    (href: Href, mode: 'push' | 'replace') => {
      setHistory((current) =>
        mode === 'replace'
          ? replaceHarmonyHistoryEntry(current, href, createKey)
          : pushHarmonyHistoryEntry(current, href, createKey)
      )
    },
    [createKey]
  )

  const router = useMemo<RouterApi>(
    () => ({
      back: () => setHistory(backHarmonyHistoryEntry),
      canGoBack: () => historyLengthRef.current > 1,
      dismissTo: (href) =>
        setHistory((current) => dismissToHarmonyHistoryEntry(current, href, createKey)),
      push: (href) => commit(href, 'push'),
      replace: (href) => commit(href, 'replace'),
      setParams: (params) => setHistory((current) => setHarmonyHistoryParams(current, params))
    }),
    [commit, createKey]
  )

  const navigation = useMemo(
    () =>
      createNavigationApi(
        historyRef,
        listenersRef.current,
        routeBackHandlersRef,
        createKey,
        setHistory
      ),
    [createKey]
  )
  const contextValue = useMemo(() => ({ navigation, route, router }), [navigation, route, router])

  const dispatchRouteBackHandler = useCallback((routeKey: string) => {
    const handlers = routeBackHandlersRef.current.get(routeKey)
    if (!handlers) {
      return false
    }
    const orderedHandlers = [...handlers]
    for (let index = orderedHandlers.length - 1; index >= 0; index -= 1) {
      if (orderedHandlers[index]()) {
        return true
      }
    }
    return false
  }, [])

  useLayoutEffect(() => {
    // Why: a routed initiator unmounts after push; publish the committed route
    // before its passive cleanup can cancel the pending host-stack transition.
    for (const listener of listenersRef.current.state) {
      listener()
    }
  }, [history])

  useEffect(() => {
    mountedRouter = router
    return () => {
      if (mountedRouter === router) {
        mountedRouter = null
      }
    }
  }, [router])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dispatchRouteBackHandler(route.key)) {
        return true
      }
      if (shouldDeferHarmonyBackPressToRoute(route.pathname)) {
        return false
      }
      if (history.length <= 1) {
        return false
      }
      router.back()
      return true
    })
    return () => subscription.remove()
  }, [dispatchRouteBackHandler, history.length, route.key, route.pathname, router])

  return (
    <RouterContext.Provider value={contextValue}>
      <LayoutDepthContext.Provider value={0}>{children}</LayoutDepthContext.Provider>
    </RouterContext.Provider>
  )
}

function useRouterContext() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('Harmony router is not mounted')
  }
  return context
}

export function useRouter(): RouterApi {
  return useRouterContext().router
}

export function usePathname(): string {
  return useRouterContext().route.pathname
}

export function useLocalSearchParams<T extends RouteParams>(): T {
  const { route } = useRouterContext()
  return getHarmonyRouteParams(route) as T
}

export const useGlobalSearchParams = useLocalSearchParams

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect])
}

export function useNavigation<T>(): T {
  return useRouterContext().navigation as T
}

export function Redirect({ href }: { href: Href }): null {
  const router = useRouter()
  useEffect(() => router.replace(href), [href, router])
  return null
}

function MissingRoute({ pathname }: { pathname: string }): React.JSX.Element {
  const Home = matchRootRoute('/')!.component
  console.warn(`[harmony-router] no route matched ${pathname}`)
  return <Home />
}

function StackComponent({
  children: _children
}: {
  children?: ReactNode
  screenOptions?: unknown
}): React.JSX.Element {
  const depth = useContext(LayoutDepthContext)
  const { route } = useRouterContext()
  const match = depth === 0 ? matchRootRoute(route.pathname) : matchHostRoute(route.pathname)
  if (!match) {
    return <MissingRoute pathname={route.pathname} />
  }
  const ScreenComponent = match.component as ComponentType
  const screenKey = depth === 0 ? route.rootKey : (route.hostRouteKey ?? route.key)
  return (
    <LayoutDepthContext.Provider value={depth + 1}>
      <ScreenComponent key={screenKey} />
    </LayoutDepthContext.Provider>
  )
}

function StackScreen(_props: { name?: string; options?: unknown }): null {
  return null
}

export const Stack = Object.assign(StackComponent, { Screen: StackScreen })

let mountedRouter: RouterApi | null = null

export const router: RouterApi = {
  back: () => mountedRouter?.back(),
  canGoBack: () => mountedRouter?.canGoBack() ?? false,
  dismissTo: (href) => mountedRouter?.dismissTo(href),
  push: (href) => mountedRouter?.push(href),
  replace: (href) => mountedRouter?.replace(href),
  setParams: (params) => mountedRouter?.setParams(params)
}
