import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectTsxFiles(path) : entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('Harmony route registry contract', () => {
  it('resolves every Expo route to its shared screen and decodes its parameters', async () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const appRoot = join(mobileRoot, 'app')
    const screens = collectTsxFiles(appRoot).map((path) => {
      const component = () => null
      vi.doMock(path, () => ({ default: component }))
      return {
        component,
        route: relative(appRoot, path)
          .split(sep)
          .join('/')
          .replace(/\.tsx$/, '')
      }
    })
    const { matchHostRoute, matchRootRoute } =
      await import('../../harmony/src/navigation/harmony-route-registry')

    for (const { component, route } of screens) {
      if (route.endsWith('_layout')) {
        continue
      }
      const pathname =
        `/${route}`
          .replace(/\/index$/, '')
          .replace('[hostId]', 'desktop%2Fone')
          .replace('[worktreeId]', 'repo%3A%3A%2Ftmp%2Ffix%20one') || '/'
      const params = {
        ...(route.includes('[hostId]') ? { hostId: 'desktop/one' } : {}),
        ...(route.includes('[worktreeId]') ? { worktreeId: 'repo::/tmp/fix one' } : {})
      }
      const name = pathname.startsWith('/h/') ? route.replace(/^h\//, '') : route || 'index'
      const match = pathname.startsWith('/h/') ? matchHostRoute : matchRootRoute
      expect(match(pathname), pathname).toEqual({ component, name, params })
    }
    expect(matchRootRoute('/h/desktop')).toMatchObject({
      component: screens.find(({ route }) => route === 'h/_layout')?.component,
      name: 'h',
      params: {}
    })
    for (const pathname of ['/h/', '/h/a/unknown', '/h/a/session/', '/h/a/session/b/extra']) {
      expect(matchHostRoute(pathname), pathname).toBeNull()
      expect(matchRootRoute(pathname), pathname).toBeNull()
    }
    expect(matchHostRoute('/h/%not-encoded/session/repo')?.params).toEqual({
      hostId: '%not-encoded',
      worktreeId: 'repo'
    })
  })
})
