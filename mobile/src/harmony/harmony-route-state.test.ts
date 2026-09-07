import { describe, expect, it } from 'vitest'

import {
  matchHarmonyHostRoutePath,
  parseHarmonyHref
} from '../../harmony/src/navigation/harmony-route-state'

describe('Harmony route state', () => {
  it('normalizes paths and decodes string query parameters', () => {
    expect(parseHarmonyHref('settings/?name=Orca+Desktop&notice=a%2Fb')).toEqual({
      pathname: '/settings',
      params: { name: 'Orca Desktop', notice: 'a/b' }
    })
  })

  it('preserves equals signs inside query parameter values', () => {
    expect(parseHarmonyHref('/pair-confirm?code=header.payload==')).toEqual({
      pathname: '/pair-confirm',
      params: { code: 'header.payload==' }
    })
  })

  it('preserves question marks inside query parameter values', () => {
    expect(parseHarmonyHref('/connection-log?next=/h/host?notice=worktree-missing')).toEqual({
      pathname: '/connection-log',
      params: { next: '/h/host?notice=worktree-missing' }
    })
  })

  it('groups repeated query parameters instead of dropping later values', () => {
    expect(parseHarmonyHref('/connection-log?notice=first&notice=second')).toEqual({
      pathname: '/connection-log',
      params: { notice: ['first', 'second'] }
    })
  })

  it('treats inherited object names as own query parameters', () => {
    const { params } = parseHarmonyHref(
      '/connection-log?toString=first&toString=second&constructor=route'
    )

    expect(Object.hasOwn(params, 'toString')).toBe(true)
    expect(Object.hasOwn(params, 'constructor')).toBe(true)
    expect(params['toString']).toEqual(['first', 'second'])
    expect(params['constructor']).toBe('route')
  })

  it('keeps __proto__ query parameters as data without changing the params prototype', () => {
    const { params } = parseHarmonyHref('/connection-log?__proto__=first&__proto__=second')

    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.hasOwn(params, '__proto__')).toBe(true)
    expect(params['__proto__']).toEqual(['first', 'second'])
  })

  it('substitutes encoded dynamic segments and retains non-path parameters', () => {
    expect(
      parseHarmonyHref({
        pathname: '/h/[hostId]/session/[worktreeId]',
        params: {
          hostId: 'desktop/one',
          worktreeId: ['tree with space'],
          created: '1'
        }
      })
    ).toEqual({
      pathname: '/h/desktop%2Fone/session/tree%20with%20space',
      params: { created: '1' }
    })
  })

  it('keeps malformed percent escapes instead of rejecting navigation', () => {
    expect(parseHarmonyHref('/connection-log?hostId=%ZZ')).toEqual({
      pathname: '/connection-log',
      params: { hostId: '%ZZ' }
    })
  })

  it('keeps array object params as array search params', () => {
    expect(
      parseHarmonyHref({
        pathname: '/connection-log',
        params: { notice: ['first', 'second'] }
      })
    ).toEqual({
      pathname: '/connection-log',
      params: { notice: ['first', 'second'] }
    })
  })

  it('does not treat plus signs in dynamic path segments as spaces', () => {
    expect(matchHarmonyHostRoutePath('/h/host+plus/session/worktree+plus')?.params).toEqual({
      hostId: 'host+plus',
      worktreeId: 'worktree+plus'
    })
  })
})
