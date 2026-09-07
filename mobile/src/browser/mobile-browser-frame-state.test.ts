import { afterEach, describe, expect, it } from 'vitest'
import {
  cacheBrowserFrame,
  clearCachedBrowserFramesForWorktree,
  getCachedBrowserFrame,
  makeBrowserFrameCacheKey,
  peekCachedBrowserFrame,
  type BrowserFrameCacheEntry
} from './mobile-browser-frame-state'
import type { MobileBrowserViewMode } from './browser-screencast-request'

const touchedScopes: Array<{ pairedHostId: string; worktreeId: string }> = []
const metadata = { deviceWidth: 390, deviceHeight: 640, pageScaleFactor: 1 }

function trackScope(pairedHostId: string, worktreeId: string): void {
  touchedScopes.push({ pairedHostId, worktreeId })
}

function frame(uri: string): BrowserFrameCacheEntry {
  return { uri, metadata }
}

function cacheKey(
  pairedHostId: string,
  worktreeId: string,
  browserPageId: string,
  viewMode: MobileBrowserViewMode = 'web'
): string {
  trackScope(pairedHostId, worktreeId)
  const key = makeBrowserFrameCacheKey(pairedHostId, worktreeId, browserPageId, viewMode)
  expect(key).toEqual(expect.any(String))
  return key!
}

afterEach(() => {
  for (const scope of touchedScopes.splice(0)) {
    clearCachedBrowserFramesForWorktree(scope.pairedHostId, scope.worktreeId)
  }
})

describe('mobile browser frame cache identity', () => {
  it('separates two paired hosts with the same worktree page and view mode', () => {
    const hostA = cacheKey('paired:host:a', 'repo::/workspace', 'page:1')
    const hostB = cacheKey('paired:host:b', 'repo::/workspace', 'page:1')

    cacheBrowserFrame(hostA, frame('data:image/jpeg;base64,host-a'))

    expect(peekCachedBrowserFrame(hostB)).toBeNull()
    expect(getCachedBrowserFrame(hostA)?.uri).toBe('data:image/jpeg;base64,host-a')
  })

  it('clears only the exact paired host and worktree scope', () => {
    const target = cacheKey('paired:host', 'repo::/workspace', 'page:target')
    const otherHost = cacheKey('paired:host:child', 'repo::/workspace', 'page:other-host')
    const otherWorktree = cacheKey('paired:host', 'repo::/workspace:child', 'page:other-worktree')

    cacheBrowserFrame(target, frame('target'))
    cacheBrowserFrame(otherHost, frame('other-host'))
    cacheBrowserFrame(otherWorktree, frame('other-worktree'))

    clearCachedBrowserFramesForWorktree('paired:host', 'repo::/workspace')

    expect(peekCachedBrowserFrame(target)).toBeNull()
    expect(peekCachedBrowserFrame(otherHost)?.uri).toBe('other-host')
    expect(peekCachedBrowserFrame(otherWorktree)?.uri).toBe('other-worktree')
  })

  it('keeps the four-entry LRU budget with host-qualified keys', () => {
    const keys = Array.from({ length: 5 }, (_, index) =>
      cacheKey('paired:lru', `repo::/workspace-${index}`, `page-${index}`)
    )

    keys.forEach((key, index) => cacheBrowserFrame(key, frame(`frame-${index}`)))

    expect(peekCachedBrowserFrame(keys[0])).toBeNull()
    expect(keys.slice(1).map((key) => peekCachedBrowserFrame(key)?.uri)).toEqual([
      'frame-1',
      'frame-2',
      'frame-3',
      'frame-4'
    ])
  })
})
