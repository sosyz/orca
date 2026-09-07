import {
  defineHarmonyRouteParam,
  getOwnHarmonyRouteParam,
  HARMONY_HOST_ROUTE_NAMES,
  HARMONY_ROOT_ROUTE_NAMES,
  hasOwnHarmonyRouteParam,
  matchHarmonyHostRoutePath,
  matchHarmonyRootRoutePath,
  parseHarmonyHref,
  type HarmonyHref,
  type HarmonyRouteParams
} from './harmony-route-state'

export type HarmonyHistoryEntry = {
  hostRouteKey?: string
  hostRouteName?: string
  hostStackKey?: string
  key: string
  params: Record<string, string | string[]>
  pathParams: Record<string, string>
  pathname: string
  rootKey: string
  rootName: string
}

export type HarmonyNavigationRoute = {
  key: string
  name: string
  params?: Record<string, string | string[]>
  state?: HarmonyNavigationState
}

export type HarmonyNavigationState = {
  index: number
  key: string
  routeNames: readonly string[]
  routes: readonly HarmonyNavigationRoute[]
  stale: false
  type: 'stack'
}

export type HarmonyHostStackReplaceAction = {
  payload?: { name?: string; params?: HarmonyRouteParams }
  source?: string
  target?: string
  type?: string
}

export type HarmonyRouteKeyFactory = (name: string) => string

function sameHostLayout(left: HarmonyHistoryEntry | null, rightPathParams: Record<string, string>) {
  return left?.rootName === 'h' && left.pathParams.hostId === rightPathParams.hostId
}

export function createHarmonyHistoryEntry(
  href: HarmonyHref,
  previous: HarmonyHistoryEntry | null,
  createKey: HarmonyRouteKeyFactory
): HarmonyHistoryEntry {
  const route = parseHarmonyHref(href)
  const rootMatch = matchHarmonyRootRoutePath(route.pathname)
  const hostMatch = matchHarmonyHostRoutePath(route.pathname)
  const rootName = rootMatch?.name ?? (route.pathname === '/' ? 'index' : route.pathname.slice(1))
  const pathParams = hostMatch?.params ?? {}
  const reusedHostLayout =
    rootName === 'h' && sameHostLayout(previous, pathParams) ? previous : null
  const rootKey = reusedHostLayout ? reusedHostLayout.rootKey : createKey(rootName)
  const hostStackKey =
    rootName === 'h'
      ? reusedHostLayout
        ? reusedHostLayout.hostStackKey
        : createKey('h')
      : undefined
  const hostRouteName = hostMatch?.name
  const hostRouteKey = hostRouteName ? createKey(hostRouteName) : undefined

  return {
    hostRouteKey,
    hostRouteName,
    hostStackKey,
    key: hostRouteKey ?? rootKey,
    params: route.params,
    pathParams,
    pathname: route.pathname,
    rootKey,
    rootName
  }
}

export function getHarmonyRouteParams(
  entry: HarmonyHistoryEntry
): Record<string, string | string[]> {
  return { ...entry.params, ...entry.pathParams }
}

export function pushHarmonyHistoryEntry(
  history: HarmonyHistoryEntry[],
  href: HarmonyHref,
  createKey: HarmonyRouteKeyFactory
): HarmonyHistoryEntry[] {
  return [
    ...history,
    createHarmonyHistoryEntry(href, history[history.length - 1] ?? null, createKey)
  ]
}

export function replaceHarmonyHistoryEntry(
  history: HarmonyHistoryEntry[],
  href: HarmonyHref,
  createKey: HarmonyRouteKeyFactory
): HarmonyHistoryEntry[] {
  const current = history[history.length - 1] ?? null
  const inheritFrom = current?.rootName === 'h' ? current : null
  return [...history.slice(0, -1), createHarmonyHistoryEntry(href, inheritFrom, createKey)]
}

export function backHarmonyHistoryEntry(history: HarmonyHistoryEntry[]): HarmonyHistoryEntry[] {
  return history.length > 1 ? history.slice(0, -1) : history
}

export function dismissToHarmonyHistoryEntry(
  history: HarmonyHistoryEntry[],
  href: HarmonyHref,
  createKey: HarmonyRouteKeyFactory
): HarmonyHistoryEntry[] {
  const target = parseHarmonyHref(href)
  let retainedIndex = -1
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].pathname === target.pathname) {
      retainedIndex = index
      break
    }
  }
  if (retainedIndex === -1) {
    return replaceHarmonyHistoryEntry(history, href, createKey)
  }
  const retained = history[retainedIndex]
  return [
    ...history.slice(0, retainedIndex),
    {
      ...retained,
      params: target.params
    }
  ]
}

export function setHarmonyHistoryParams(
  history: HarmonyHistoryEntry[],
  params: HarmonyRouteParams
): HarmonyHistoryEntry[] {
  const current = history[history.length - 1]
  if (!current) {
    return history
  }
  const nextParams = { ...current.params }
  let changed = false
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      if (hasOwnHarmonyRouteParam(nextParams, key)) {
        delete nextParams[key]
        changed = true
      }
    } else {
      const nextValue = Array.isArray(value) ? [...value] : value
      if (!sameHarmonyParamValue(getOwnHarmonyRouteParam(nextParams, key), nextValue)) {
        defineHarmonyRouteParam(nextParams, key, nextValue)
        changed = true
      }
    }
  }
  return changed ? [...history.slice(0, -1), { ...current, params: nextParams }] : history
}

function sameHarmonyParamValue(
  left: string | string[] | undefined,
  right: string | string[]
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return left === right
  }
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function replaceHarmonyHostStackRoute(
  history: HarmonyHistoryEntry[],
  action: HarmonyHostStackReplaceAction,
  createKey: HarmonyRouteKeyFactory
): HarmonyHistoryEntry[] {
  const current = history[history.length - 1]
  const name = action.payload?.name
  if (!current || current.rootName !== 'h' || !name || action.type !== 'REPLACE') {
    return history
  }
  if (
    !current.hostStackKey ||
    !current.hostRouteKey ||
    action.target !== current.hostStackKey ||
    action.source !== current.hostRouteKey ||
    !HARMONY_HOST_ROUTE_NAMES.includes(name)
  ) {
    return history
  }
  const next = createHarmonyHistoryEntry(
    { pathname: `/h/${name}`, params: action.payload?.params },
    current,
    createKey
  )
  return [...history.slice(0, -1), next]
}

function isHostStackEntry(entry: HarmonyHistoryEntry): boolean {
  return entry.rootName === 'h' && !!entry.hostRouteName && !!entry.hostRouteKey
}

function routeParams(entry: HarmonyHistoryEntry): Record<string, string | string[]> | undefined {
  const params = getHarmonyRouteParams(entry)
  return Object.keys(params).length > 0 ? params : undefined
}

function navigationRouteForRootEntry(entry: HarmonyHistoryEntry): HarmonyNavigationRoute {
  return {
    key: entry.rootKey,
    name: entry.rootName,
    params: routeParams(entry)
  }
}

function navigationRouteForHostEntry(entry: HarmonyHistoryEntry): HarmonyNavigationRoute | null {
  if (!entry.hostRouteName || !entry.hostRouteKey) {
    return null
  }
  return {
    key: entry.hostRouteKey,
    name: entry.hostRouteName,
    params: routeParams(entry)
  }
}

function navigationRouteForHostGroup(
  entries: readonly HarmonyHistoryEntry[]
): HarmonyNavigationRoute {
  const first = entries[0]!
  const hostRoutes = entries
    .map((entry) => navigationRouteForHostEntry(entry))
    .filter((route): route is HarmonyNavigationRoute => route !== null)
  return {
    key: first.rootKey,
    name: 'h',
    params: first.pathParams.hostId ? { hostId: first.pathParams.hostId } : undefined,
    state: {
      index: hostRoutes.length - 1,
      key: first.hostStackKey ?? first.rootKey,
      routeNames: HARMONY_HOST_ROUTE_NAMES,
      routes: hostRoutes,
      stale: false,
      type: 'stack'
    }
  }
}

export function createHarmonyNavigationState(
  history: readonly HarmonyHistoryEntry[]
): HarmonyNavigationState {
  const routes: HarmonyNavigationRoute[] = []
  let index = 0
  while (index < history.length) {
    const entry = history[index]
    if (!isHostStackEntry(entry)) {
      routes.push(navigationRouteForRootEntry(entry))
      index += 1
      continue
    }
    const hostStart = index
    while (
      index < history.length &&
      isHostStackEntry(history[index]) &&
      history[index].rootKey === entry.rootKey
    ) {
      index += 1
    }
    routes.push(navigationRouteForHostGroup(history.slice(hostStart, index)))
  }
  return {
    index: Math.max(0, routes.length - 1),
    key: 'harmony-root-stack',
    routeNames: HARMONY_ROOT_ROUTE_NAMES,
    routes,
    stale: false,
    type: 'stack'
  }
}
