export type HarmonyRouteParamValue = string | string[] | undefined

export type HarmonyRouteParams = Record<string, HarmonyRouteParamValue>

export type HarmonyHref = string | { pathname: string; params?: HarmonyRouteParams }

export type HarmonyRouteState = {
  pathname: string
  params: Record<string, string | string[]>
}

export type HarmonyRoutePathMatch = {
  name: string
  params: Record<string, string>
}

const ROOT_ROUTE_NAMES = new Map<string, string>([
  ['/', 'index'],
  ['/about', 'about'],
  ['/browser-settings', 'browser-settings'],
  ['/connection-log', 'connection-log'],
  ['/mobile-onboarding', 'mobile-onboarding'],
  ['/native-chat-settings', 'native-chat-settings'],
  ['/notification-opt-in', 'notification-opt-in'],
  ['/notifications', 'notifications'],
  ['/pair', 'pair'],
  ['/pair-confirm', 'pair-confirm'],
  ['/pair-scan', 'pair-scan'],
  ['/settings', 'settings'],
  ['/terminal-settings', 'terminal-settings'],
  ['/troubleshoot', 'troubleshoot'],
  ['/voice-settings', 'voice-settings']
])

const HOST_ROUTE_PATTERNS: [pattern: RegExp, name: string][] = [
  [/^\/h\/([^/]+)$/, '[hostId]/index'],
  [/^\/h\/([^/]+)\/accounts$/, '[hostId]/accounts'],
  [/^\/h\/([^/]+)\/edit$/, '[hostId]/edit'],
  [/^\/h\/([^/]+)\/tasks$/, '[hostId]/tasks'],
  [/^\/h\/([^/]+)\/agent-history\/([^/]+)$/, '[hostId]/agent-history/[worktreeId]'],
  [/^\/h\/([^/]+)\/files\/preview\/([^/]+)$/, '[hostId]/files/preview/[worktreeId]'],
  [/^\/h\/([^/]+)\/files\/([^/]+)$/, '[hostId]/files/[worktreeId]'],
  [/^\/h\/([^/]+)\/history\/([^/]+)$/, '[hostId]/history/[worktreeId]'],
  [/^\/h\/([^/]+)\/pr\/([^/]+)$/, '[hostId]/pr/[worktreeId]'],
  [/^\/h\/([^/]+)\/review\/([^/]+)$/, '[hostId]/review/[worktreeId]'],
  [/^\/h\/([^/]+)\/session\/([^/]+)$/, '[hostId]/session/[worktreeId]'],
  [/^\/h\/([^/]+)\/source-control\/([^/]+)$/, '[hostId]/source-control/[worktreeId]']
]

const hasOwnRouteParam = Object.prototype.hasOwnProperty

export const HARMONY_ROOT_ROUTE_NAMES = [...ROOT_ROUTE_NAMES.values(), 'h'] as const
export const HARMONY_HOST_ROUTE_NAMES = HOST_ROUTE_PATTERNS.map(([, name]) => name)

export function hasOwnHarmonyRouteParam(params: Record<string, unknown>, key: string): boolean {
  return hasOwnRouteParam.call(params, key)
}

export function getOwnHarmonyRouteParam<T>(params: Record<string, T>, key: string): T | undefined {
  return hasOwnHarmonyRouteParam(params, key) ? params[key] : undefined
}

export function defineHarmonyRouteParam<T>(params: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(params, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function splitHrefSource(source: string): [pathname: string, query: string] {
  const queryStart = source.indexOf('?')
  if (queryStart === -1) {
    return [source, '']
  }
  return [source.slice(0, queryStart), source.slice(queryStart + 1)]
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function assignQueryParam(
  params: Record<string, string | string[]>,
  key: string,
  value: string
): void {
  const existing = getOwnHarmonyRouteParam(params, key)
  if (existing === undefined) {
    defineHarmonyRouteParam(params, key, value)
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    defineHarmonyRouteParam(params, key, [existing, value])
  }
}

function parseQueryParams(query: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}
  for (const pair of query.split('&')) {
    if (!pair) {
      continue
    }
    const separator = pair.indexOf('=')
    const key = decodeQueryPart(separator === -1 ? pair : pair.slice(0, separator))
    const value = separator === -1 ? '' : pair.slice(separator + 1)
    assignQueryParam(params, key, decodeQueryPart(value))
  }
  return params
}

export function parseHarmonyHref(href: HarmonyHref): HarmonyRouteState {
  const source = typeof href === 'string' ? href : href.pathname
  const [rawPathname, rawQuery] = splitHrefSource(source)
  const objectParams: HarmonyRouteParams = typeof href === 'string' ? {} : (href.params ?? {})
  const consumed = new Set<string>()
  const pathname = rawPathname.replace(/\[([^\]]+)\]/g, (_match, name: string) => {
    const value = getOwnHarmonyRouteParam(objectParams, name)
    if (value === undefined) {
      return `[${name}]`
    }
    consumed.add(name)
    return encodeURIComponent(Array.isArray(value) ? (value[0] ?? '') : value)
  })

  const params = parseQueryParams(rawQuery)
  for (const [key, value] of Object.entries(objectParams)) {
    if (value !== undefined && !consumed.has(key)) {
      defineHarmonyRouteParam(params, key, Array.isArray(value) ? [...value] : value)
    }
  }
  return { pathname: normalizePathname(pathname), params }
}

export function matchHarmonyRootRoutePath(pathname: string): HarmonyRoutePathMatch | null {
  if (matchHarmonyHostRoutePath(pathname)) {
    return { name: 'h', params: {} }
  }
  const name = ROOT_ROUTE_NAMES.get(pathname)
  return name ? { name, params: {} } : null
}

export function matchHarmonyHostRoutePath(pathname: string): HarmonyRoutePathMatch | null {
  for (const [pattern, name] of HOST_ROUTE_PATTERNS) {
    const match = pattern.exec(pathname)
    if (!match) {
      continue
    }
    const params: Record<string, string> = { hostId: decodePathPart(match[1]) }
    if (match[2] !== undefined) {
      params.worktreeId = decodePathPart(match[2])
    }
    return { name, params }
  }
  return null
}
