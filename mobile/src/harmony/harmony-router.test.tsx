import { createElement, useEffect, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HarmonyRouterProvider,
  Stack,
  shouldDeferHarmonyBackPressToRoute,
  useNavigation,
  useLocalSearchParams,
  usePathname,
  useRouter
} from '../../harmony/src/navigation/harmony-router'
import {
  navigateToHostStackRoute,
  type HostStackRootNavigation
} from '../navigation/host-stack-navigation'

const routeRegistry = vi.hoisted(() => ({
  matchRootRoute: vi.fn(),
  matchHostRoute: vi.fn((pathname: string) => {
    const match = /^\/h\/([^/]+)/.exec(pathname)
    return match
      ? { component: () => null, params: { hostId: decodeURIComponent(match[1]) } }
      : null
  })
}))
const backHandlerMock = vi.hoisted(() => {
  const listeners: Array<() => boolean> = []
  return {
    listeners,
    addEventListener: vi.fn((_event: string, listener: () => boolean) => {
      listeners.push(listener)
      return {
        remove: vi.fn(() => {
          const index = listeners.indexOf(listener)
          if (index !== -1) {
            listeners.splice(index, 1)
          }
        })
      }
    })
  }
})

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: backHandlerMock.addEventListener }
}))

vi.mock('../../harmony/node_modules/react-native/index.js', () => ({
  BackHandler: { addEventListener: backHandlerMock.addEventListener }
}))

vi.mock('../../harmony/node_modules/react/index.js', async () => {
  return vi.importActual<typeof import('react')>('react')
})

vi.mock('../../harmony/src/navigation/harmony-route-registry', () => ({
  matchHostRoute: routeRegistry.matchHostRoute,
  matchRootRoute: routeRegistry.matchRootRoute
}))

describe('Harmony router', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    routeRegistry.matchRootRoute.mockReset()
    routeRegistry.matchHostRoute.mockImplementation((pathname: string) => {
      const match = /^\/h\/([^/]+)/.exec(pathname)
      return match
        ? { component: () => null, params: { hostId: decodeURIComponent(match[1]) } }
        : null
    })
    backHandlerMock.listeners.length = 0
    backHandlerMock.addEventListener.mockClear()
  })

  it('defers session back presses to the route-specific unsaved-work handler', () => {
    expect(
      shouldDeferHarmonyBackPressToRoute('/h/desktop%2Fone/session/repo%3A%3A%2Ftmp%2Ffix%20one')
    ).toBe(true)
    expect(shouldDeferHarmonyBackPressToRoute('/h/desktop%2Fone/files/repo')).toBe(false)
    expect(shouldDeferHarmonyBackPressToRoute('/h/desktop%2Fone')).toBe(false)
  })

  it('lets onboarding consume hardware back after replacing the pairing route', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let pathname = '/'
    const blockBack = vi.fn(() => true)
    function OnboardingRoute() {
      useEffect(() => {
        const subscription = backHandlerMock.addEventListener('hardwareBackPress', blockBack)
        return () => subscription.remove()
      }, [])
      return null
    }
    function PlainRoute() {
      return null
    }
    function App() {
      observedRouter = useRouter()
      pathname = usePathname()
      return createElement(Stack)
    }
    routeRegistry.matchRootRoute.mockImplementation((path: string) => ({
      component: path === '/mobile-onboarding' ? OnboardingRoute : PlainRoute,
      params: {}
    }))
    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(App)))
    })
    act(() => observedRouter!.push('/pair-scan'))
    act(() => observedRouter!.replace('/mobile-onboarding'))
    expect(observedRouter!.canGoBack()).toBe(true)
    act(() => {
      for (const handler of backHandlerMock.listeners.toReversed()) {
        if (handler()) {
          break
        }
      }
    })
    expect(blockBack).toHaveBeenCalledOnce()
    expect(pathname).toBe('/mobile-onboarding')

    act(() => observedRouter!.replace('/settings'))
    act(() => {
      for (const handler of backHandlerMock.listeners.toReversed()) {
        if (handler()) {
          break
        }
      }
    })
    expect(pathname).toBe('/')
    expect(blockBack).toHaveBeenCalledOnce()
  })

  it('lets the current route own hardware back without leaking guards to later routes', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let pathname = '/'
    const previewBack = vi.fn(() => true)

    function HostLayout() {
      return createElement(Stack)
    }

    function PreviewRoute() {
      const navigation = useNavigation<{
        registerBackHandler(handler: () => boolean): () => void
      }>()
      pathname = usePathname()
      useEffect(() => navigation.registerBackHandler(previewBack), [navigation])
      return null
    }

    function PlainFilesRoute() {
      pathname = usePathname()
      return null
    }

    function App() {
      observedRouter = useRouter()
      return createElement(Stack)
    }

    routeRegistry.matchRootRoute.mockImplementation((pathname: string) =>
      pathname.startsWith('/h/')
        ? { component: HostLayout, params: {} }
        : { component: () => null, params: {} }
    )
    routeRegistry.matchHostRoute.mockImplementation((pathname: string) => {
      const previewMatch = /^\/h\/([^/]+)\/files\/preview\/([^/]+)/.exec(pathname)
      if (previewMatch) {
        return {
          component: PreviewRoute,
          params: {
            hostId: decodeURIComponent(previewMatch[1]),
            worktreeId: decodeURIComponent(previewMatch[2])
          }
        }
      }
      const filesMatch = /^\/h\/([^/]+)\/files\/([^/]+)/.exec(pathname)
      if (filesMatch) {
        return {
          component: PlainFilesRoute,
          params: {
            hostId: decodeURIComponent(filesMatch[1]),
            worktreeId: decodeURIComponent(filesMatch[2])
          }
        }
      }
      return null
    })

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(App)))
    })

    act(() => observedRouter!.push('/h/host/files/preview/worktree'))
    expect(pathname).toBe('/h/host/files/preview/worktree')

    let handled = false
    act(() => {
      handled = backHandlerMock.listeners.at(-1)?.() ?? false
    })
    expect(handled).toBe(true)
    expect(previewBack).toHaveBeenCalledOnce()
    expect(pathname).toBe('/h/host/files/preview/worktree')

    act(() => observedRouter!.push('/h/host/files/worktree'))
    expect(pathname).toBe('/h/host/files/worktree')

    act(() => {
      handled = backHandlerMock.listeners.at(-1)?.() ?? false
    })
    expect(handled).toBe(true)
    expect(previewBack).toHaveBeenCalledOnce()
    expect(pathname).toBe('/h/host/files/preview/worktree')
  })

  it('keeps the router API stable while navigation history changes', async () => {
    const observedRouters: ReturnType<typeof useRouter>[] = []

    function Probe() {
      observedRouters.push(useRouter())
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })
    const initialRouter = observedRouters.at(-1)!
    expect(initialRouter.canGoBack()).toBe(false)

    act(() => initialRouter.push('/settings'))
    expect(observedRouters.at(-1)).toBe(initialRouter)
    expect(initialRouter.canGoBack()).toBe(true)

    act(() => initialRouter.back())
    expect(observedRouters.at(-1)).toBe(initialRouter)
    expect(initialRouter.canGoBack()).toBe(false)
  })

  it('publishes a dynamic path host id to coordinated host-stack navigation', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/desktop%2Fone'))

    const state = observedNavigation!.getState()
    expect(state.routes[state.index]).toMatchObject({
      name: 'h',
      params: { hostId: 'desktop/one' },
      state: {
        routes: [
          {
            name: '[hostId]/index',
            params: { hostId: 'desktop/one' }
          }
        ]
      }
    })
  })

  it('publishes the active host-stack child instead of inventing host index state', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => {
      observedRouter!.push({
        pathname: '/h/[hostId]/session/[worktreeId]',
        params: {
          hostId: 'desktop/one',
          worktreeId: 'repo::/tmp/fix one',
          name: 'Fix one'
        }
      })
    })

    const state = observedNavigation!.getState()
    expect(state.routes).toHaveLength(2)
    expect(state.index).toBe(1)
    expect(state.routes[1]).toMatchObject({
      name: 'h',
      params: { hostId: 'desktop/one' },
      state: {
        index: 0,
        routes: [
          {
            name: '[hostId]/session/[worktreeId]',
            params: {
              hostId: 'desktop/one',
              worktreeId: 'repo::/tmp/fix one',
              name: 'Fix one'
            }
          }
        ]
      }
    })
  })

  it('projects same-host history entries as one nested host stack', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/host-a'))
    act(() => observedRouter!.push('/h/host-a/session/worktree-one?name=Session+one'))
    act(() => observedRouter!.push('/h/host-a/files/worktree-two'))

    const state = observedNavigation!.getState()
    const hostRoute = state.routes[1]
    const hostState = hostRoute.state!
    expect(state.index).toBe(1)
    expect(state.routes).toHaveLength(2)
    expect(hostState.index).toBe(2)
    expect(hostState.routes.map((route) => route.name)).toEqual([
      '[hostId]/index',
      '[hostId]/session/[worktreeId]',
      '[hostId]/files/[worktreeId]'
    ])
    expect(hostState.routes[1]).toMatchObject({
      params: { hostId: 'host-a', name: 'Session one', worktreeId: 'worktree-one' }
    })
    expect(new Set([hostRoute.key, ...hostState.routes.map((route) => route.key)]).size).toBe(4)
  })

  it('keeps separate host stacks for host changes and host exits', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/host-a'))
    act(() => observedRouter!.push('/h/host-a/session/worktree-one'))
    act(() => observedRouter!.push('/h/host-b'))

    const crossHostState = observedNavigation!.getState()
    expect(crossHostState.routes.map((route) => route.params?.hostId)).toEqual([
      undefined,
      'host-a',
      'host-b'
    ])
    expect(crossHostState.routes[1].state?.routes).toHaveLength(2)
    expect(crossHostState.routes[2].state?.routes).toHaveLength(1)

    act(() => observedRouter!.push('/settings'))
    act(() => observedRouter!.push('/h/host-a/tasks'))

    const reenteredState = observedNavigation!.getState()
    expect(reenteredState.routes.map((route) => route.name)).toEqual([
      'index',
      'h',
      'h',
      'settings',
      'h'
    ])
    expect(reenteredState.index).toBe(4)
    expect(reenteredState.routes[4]).toMatchObject({
      params: { hostId: 'host-a' },
      state: {
        index: 0,
        routes: [{ name: '[hostId]/tasks', params: { hostId: 'host-a' } }]
      }
    })
    const hostKeys = reenteredState.routes
      .filter((route) => route.name === 'h')
      .map((route) => route.key)
    expect(new Set(hostKeys).size).toBe(3)
  })

  it('does not merge a root-screen replace back into an earlier host stack', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/host-a'))
    act(() => observedRouter!.push('/settings'))
    act(() => observedRouter!.replace('/h/host-a/tasks'))

    const state = observedNavigation!.getState()
    expect(state.routes.map((route) => route.name)).toEqual(['index', 'h', 'h'])
    expect(state.routes[1].state?.routes).toHaveLength(1)
    expect(state.routes[2].state?.routes).toHaveLength(1)
    expect(state.routes[1].key).not.toBe(state.routes[2].key)
  })

  it('keeps dynamic path params authoritative over same-name query params', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let params: { hostId?: string; worktreeId?: string } = {}

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      params = useLocalSearchParams<{ hostId?: string; worktreeId?: string }>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => {
      observedRouter!.push(
        '/h/path-host/session/path-worktree?hostId=query-host&worktreeId=query-worktree'
      )
    })

    expect(params).toMatchObject({ hostId: 'path-host', worktreeId: 'path-worktree' })
    expect(observedNavigation!.getState().routes[1]).toMatchObject({
      params: { hostId: 'path-host' },
      state: {
        routes: [
          {
            params: { hostId: 'path-host', worktreeId: 'path-worktree' }
          }
        ]
      }
    })
  })

  it('preserves repeated query params through local params and navigation state', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let params: { tag?: string | string[] } = {}

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      params = useLocalSearchParams<{ tag?: string | string[] }>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/connection-log?tag=one&tag=two'))

    expect(params).toEqual({ tag: ['one', 'two'] })
    expect(observedNavigation!.getState().routes[1]).toMatchObject({
      name: 'connection-log',
      params: { tag: ['one', 'two'] }
    })
  })

  it('preserves prototype-named query params through local params and navigation state', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let params: Record<string, string | string[] | undefined> = {}

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      params = useLocalSearchParams<Record<string, string | string[] | undefined>>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() =>
      observedRouter!.push(
        '/connection-log?toString=first&toString=second&constructor=route&__proto__=proto'
      )
    )

    const routeParams = observedNavigation!.getState().routes[1].params!
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(routeParams)).toBe(Object.prototype)
    for (const key of ['toString', 'constructor', '__proto__']) {
      expect(Object.hasOwn(params, key)).toBe(true)
      expect(Object.hasOwn(routeParams, key)).toBe(true)
    }
    expect(params['toString']).toEqual(['first', 'second'])
    expect(params['constructor']).toBe('route')
    expect(params['__proto__']).toBe('proto')
    expect(routeParams['toString']).toEqual(['first', 'second'])
    expect(routeParams['constructor']).toBe('route')
    expect(routeParams['__proto__']).toBe('proto')
  })

  it('does not publish a state change when setParams keeps the same array values', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/connection-log?tag=one&tag=two'))
    let stateEvents = 0
    const unsubscribe = observedNavigation!.addListener('state', () => {
      stateEvents += 1
    })

    act(() => observedRouter!.setParams({ tag: ['one', 'two'] }))

    expect(stateEvents).toBe(0)
    unsubscribe()
  })

  it('does not publish an empty host stack for unmatched /h paths', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/host-a/unknown'))

    expect(observedNavigation!.getState().routes[1]).toMatchObject({
      name: 'h/host-a/unknown'
    })
    expect(observedNavigation!.getState().routes[1].state).toBeUndefined()
  })

  it('ignores host-stack replace actions with stale target or source keys', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let pathname = '/'

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      pathname = usePathname()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/h/desktop%2Fone'))
    const hostState = observedNavigation!.getState().routes[1].state!
    const hostRoute = hostState.routes[hostState.index]

    act(() => {
      observedNavigation!.dispatch({
        type: 'REPLACE',
        target: 'stale-host-stack',
        source: hostRoute.key!,
        payload: {
          name: '[hostId]/session/[worktreeId]',
          params: { hostId: 'desktop/one', worktreeId: 'repo::/tmp/fix one' }
        }
      })
    })
    expect(pathname).toBe('/h/desktop%2Fone')

    act(() => {
      observedNavigation!.dispatch({
        type: 'REPLACE',
        target: hostState.key!,
        source: 'stale-host-route',
        payload: {
          name: '[hostId]/session/[worktreeId]',
          params: { hostId: 'desktop/one', worktreeId: 'repo::/tmp/fix one' }
        }
      })
    })
    expect(pathname).toBe('/h/desktop%2Fone')

    act(() => {
      observedNavigation!.dispatch({
        type: 'REPLACE',
        target: hostState.key!,
        source: hostRoute.key!,
        payload: {
          name: '[hostId]/session/[worktreeId]',
          params: { hostId: 'desktop/one', worktreeId: 'repo::/tmp/fix one' }
        }
      })
    })
    expect(pathname).toBe('/h/desktop%2Fone/session/repo%3A%3A%2Ftmp%2Ffix%20one')
  })

  it('dismisses to an existing history target instead of resetting all history', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let pathname = '/'

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      pathname = usePathname()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    act(() => observedRouter!.push('/settings'))
    act(() => observedRouter!.push('/about'))
    act(() => observedRouter!.dismissTo('/settings?from=about'))

    expect(pathname).toBe('/settings')
    expect(observedRouter!.canGoBack()).toBe(true)
    expect(observedNavigation!.getState()).toMatchObject({
      index: 1,
      routes: [{ name: 'index' }, { name: 'settings', params: { from: 'about' } }]
    })
  })

  it('rekeys same-component host routes on workspace navigation but not setParams', async () => {
    const snapshots: Array<{
      mountedWorktreeId: string
      params: { note?: string; worktreeId: string }
    }> = []
    let mountCount = 0
    let observedRouter: ReturnType<typeof useRouter> | null = null

    function HostLayout() {
      return createElement(Stack)
    }

    function SessionRoute() {
      const router = useRouter()
      const params = useLocalSearchParams<{ note?: string; worktreeId: string }>()
      const mountedWorktreeId = useRef(params.worktreeId).current
      useEffect(() => {
        mountCount += 1
      }, [])
      observedRouter = router
      snapshots.push({ mountedWorktreeId, params })
      return null
    }

    function App() {
      observedRouter = useRouter()
      return createElement(Stack)
    }

    routeRegistry.matchRootRoute.mockImplementation((pathname: string) =>
      pathname.startsWith('/h/')
        ? { component: HostLayout, params: {} }
        : { component: () => null, params: {} }
    )
    routeRegistry.matchHostRoute.mockImplementation((pathname: string) => {
      const match = /^\/h\/([^/]+)\/session\/([^/]+)/.exec(pathname)
      if (!match) {
        return null
      }
      return {
        component: SessionRoute,
        params: {
          hostId: decodeURIComponent(match[1]),
          worktreeId: decodeURIComponent(match[2])
        }
      }
    })

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(App)))
    })

    act(() => observedRouter!.push('/h/host/session/worktree-one'))
    expect(snapshots.at(-1)).toMatchObject({
      mountedWorktreeId: 'worktree-one',
      params: { worktreeId: 'worktree-one' }
    })
    expect(mountCount).toBe(1)

    act(() => observedRouter!.setParams({ note: 'kept' }))
    expect(snapshots.at(-1)).toMatchObject({
      mountedWorktreeId: 'worktree-one',
      params: { note: 'kept', worktreeId: 'worktree-one' }
    })
    expect(mountCount).toBe(1)

    act(() => observedRouter!.push('/h/host/session/worktree-two'))
    expect(snapshots.at(-1)).toMatchObject({
      mountedWorktreeId: 'worktree-two',
      params: { worktreeId: 'worktree-two' }
    })
    expect(mountCount).toBe(2)
  })

  it('completes a cold host-to-session transition from a dynamic host path', async () => {
    let observedRouter: ReturnType<typeof useRouter> | null = null
    let observedNavigation: HostStackRootNavigation | null = null
    let pathname = '/'

    function Probe() {
      observedRouter = useRouter()
      observedNavigation = useNavigation<HostStackRootNavigation>()
      pathname = usePathname()
      return null
    }

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Probe)))
    })

    await act(async () => {
      navigateToHostStackRoute(observedNavigation!, observedRouter!, 'desktop/one', {
        name: '[hostId]/session/[worktreeId]',
        params: {
          hostId: 'desktop/one',
          worktreeId: 'repo::/tmp/fix one',
          name: 'Fix one'
        }
      })
    })

    expect(pathname).toBe('/h/desktop%2Fone/session/repo%3A%3A%2Ftmp%2Ffix%20one')
  })

  it('finishes the coordinated transition before its routed initiator cleanup cancels it', async () => {
    let openSession: (() => void) | null = null
    let destinationPathname = ''

    function HomeRoute() {
      const navigation = useNavigation()
      const router = useRouter()
      const controllerRef = useRef<ReturnType<typeof navigateToHostStackRoute> | null>(null)
      useEffect(
        () => () => {
          controllerRef.current?.cancel()
        },
        []
      )
      openSession = () => {
        controllerRef.current = navigateToHostStackRoute(navigation, router, 'desktop/one', {
          name: '[hostId]/session/[worktreeId]',
          params: {
            hostId: 'desktop/one',
            worktreeId: 'repo::/tmp/fix one',
            name: 'Fix one'
          }
        })
      }
      return null
    }

    function HostRoute() {
      destinationPathname = usePathname()
      return null
    }

    routeRegistry.matchRootRoute.mockImplementation((pathname: string) => ({
      component: pathname === '/' ? HomeRoute : HostRoute,
      params: {}
    }))

    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(Stack)))
    })

    await act(async () => {
      openSession!()
    })

    expect(destinationPathname).toBe('/h/desktop%2Fone/session/repo%3A%3A%2Ftmp%2Ffix%20one')
  })
})
