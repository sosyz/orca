import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Harmony file-name sorting without Intl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads and preserves natural numeric ordering', async () => {
    vi.stubGlobal('Intl', undefined)
    vi.resetModules()

    const { compareFileNames } = await import('../../../src/shared/file-name-sort')
    const names = ['file100.txt', 'file9.txt', 'file02.txt', 'file2.txt']

    expect([...names].sort(compareFileNames)).toEqual([
      'file02.txt',
      'file2.txt',
      'file9.txt',
      'file100.txt'
    ])
  })

  it('compares numeric runs without losing precision', async () => {
    vi.stubGlobal('Intl', undefined)
    vi.resetModules()

    const { compareFileNames } = await import('../../../src/shared/file-name-sort')

    expect(compareFileNames('file99999999999999999999', 'file100000000000000000000')).toBeLessThan(
      0
    )
  })
})
