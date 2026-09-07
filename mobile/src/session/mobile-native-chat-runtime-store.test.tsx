import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendMobileNativeChatPendingMessage,
  appendMobileNativeChatUnconfirmedSend,
  clearMobileNativeChatDraftForSend,
  clearMobileNativeChatRuntimeStoreForTests,
  ensureMobileNativeChatRuntimeScope,
  getMobileNativeChatRuntimeScope,
  migrateMobileNativeChatImagePreviewMessageIds,
  purgeMobileNativeChatRuntimeScope,
  purgeMobileNativeChatRuntimeScopesForHost,
  readMobileNativeChatDraftText,
  readMobileNativeChatDraftEditGeneration,
  readMobileNativeChatPending,
  readMobileNativeChatSendError,
  restoreMobileNativeChatRejectedDraft,
  updateMobileNativeChatDraftText,
  updateMobileNativeChatSessionPending,
  useMobileNativeChatRuntimeScopeToken,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

function tokenFor(scopeKey: string): MobileNativeChatRuntimeScopeToken {
  const scope = ensureMobileNativeChatRuntimeScope(scopeKey)
  return { scopeKey, generation: scope.generation }
}

function originFor(scopeKey: string, generation: number): MobileNativeChatSendOrigin {
  return {
    draftKey: scopeKey,
    pendingKey: `${scopeKey}\0session`,
    draftEditGeneration: getMobileNativeChatRuntimeScope(scopeKey)?.draftEditGeneration ?? 0,
    scopeGeneration: generation,
    normalizedText: 'ping',
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true
  }
}

describe('mobile native-chat runtime store', () => {
  let renderer: ReactTestRenderer | null = null
  let retainedToken: MobileNativeChatRuntimeScopeToken | null = null
  let renderCount = 0

  function Retainer({ scopeKey }: { scopeKey: string }): null {
    renderCount += 1
    retainedToken = useMobileNativeChatRuntimeScopeToken(scopeKey)
    return null
  }

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    retainedToken = null
    renderCount = 0
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    clearMobileNativeChatRuntimeStoreForTests()
    vi.useRealTimers()
  })

  it('evicts inactive scopes while preserving the active scope', () => {
    act(() => {
      renderer = create(createElement(Retainer, { scopeKey: 'host\0wt\0active' }))
    })
    updateMobileNativeChatDraftText(retainedToken, 'kept')

    for (let index = 0; index < 33; index++) {
      const scopeKey = `host\0wt\0inactive-${index}`
      updateMobileNativeChatDraftText(tokenFor(scopeKey), `value-${index}`)
    }

    expect(readMobileNativeChatDraftText('host\0wt\0active')).toBe('kept')
    expect(readMobileNativeChatDraftText('host\0wt\0inactive-0')).toBe('')
    expect(readMobileNativeChatDraftText('host\0wt\0inactive-32')).toBe('value-32')
  })

  it('purges timers and keeps stale tokens from reviving a scope', () => {
    vi.useFakeTimers()
    const scopeKey = 'host\0wt\0tab'
    const token = tokenFor(scopeKey)
    const origin = originFor(scopeKey, token.generation)

    appendMobileNativeChatUnconfirmedSend(origin, 'Delivery unconfirmed', 20_000)
    expect(vi.getTimerCount()).toBe(1)

    purgeMobileNativeChatRuntimeScope(scopeKey)
    expect(vi.getTimerCount()).toBe(0)
    appendMobileNativeChatPendingMessage(origin, 'ping')
    restoreMobileNativeChatRejectedDraft(origin, 'ping')
    vi.advanceTimersByTime(20_000)

    expect(readMobileNativeChatDraftText(scopeKey)).toBe('')
    expect(readMobileNativeChatPending(scopeKey, `${scopeKey}\0session`)).toEqual([])
    expect(readMobileNativeChatSendError(scopeKey)).toBeNull()
    expect(tokenFor(scopeKey).generation).not.toBe(token.generation)
  })

  it('purges only scopes owned by the removed host', () => {
    const hostOne = tokenFor('host-1\0wt\0tab')
    const hostTwo = tokenFor('host-2\0wt\0tab')
    updateMobileNativeChatDraftText(hostOne, 'remove me')
    updateMobileNativeChatDraftText(hostTwo, 'keep me')

    purgeMobileNativeChatRuntimeScopesForHost('host-1')
    restoreMobileNativeChatRejectedDraft(originFor(hostOne.scopeKey, hostOne.generation), 'late')

    expect(readMobileNativeChatDraftText(hostOne.scopeKey)).toBe('')
    expect(readMobileNativeChatDraftText(hostTwo.scopeKey)).toBe('keep me')
  })

  it('keeps shared state through same-scope subscriber teardown', () => {
    act(() => {
      renderer = create(createElement(Retainer, { scopeKey: 'host\0wt\0tab' }))
    })
    updateMobileNativeChatDraftText(retainedToken, 'draft')

    act(() => renderer?.unmount())
    renderer = null
    act(() => {
      renderer = create(createElement(Retainer, { scopeKey: 'host\0wt\0tab' }))
    })

    expect(readMobileNativeChatDraftText('host\0wt\0tab')).toBe('draft')
  })

  it('preserves later edits even when they return the draft to empty', () => {
    const scopeKey = 'host\0wt\0tab'
    const token = tokenFor(scopeKey)
    updateMobileNativeChatDraftText(token, 'ping')
    const origin = originFor(scopeKey, token.generation)

    clearMobileNativeChatDraftForSend(origin, 'ping')
    updateMobileNativeChatDraftText(token, 'newer edit')
    updateMobileNativeChatDraftText(token, '')
    restoreMobileNativeChatRejectedDraft(origin, 'ping')

    expect(readMobileNativeChatDraftText(scopeKey)).toBe('')
    expect(readMobileNativeChatDraftEditGeneration(token)).toBe(origin.draftEditGeneration + 2)
  })

  it('does not clear a newer same-text or whitespace edit', () => {
    const scopeKey = 'host\0wt\0tab'
    const token = tokenFor(scopeKey)
    updateMobileNativeChatDraftText(token, 'ping')
    const origin = originFor(scopeKey, token.generation)

    updateMobileNativeChatDraftText(token, 'other')
    updateMobileNativeChatDraftText(token, 'ping')
    clearMobileNativeChatDraftForSend(origin, 'ping')
    expect(readMobileNativeChatDraftText(scopeKey)).toBe('ping')

    const newerOrigin = originFor(scopeKey, token.generation)
    updateMobileNativeChatDraftText(token, ' ping')
    clearMobileNativeChatDraftForSend(newerOrigin, 'ping')
    expect(readMobileNativeChatDraftText(scopeKey)).toBe(' ping')
  })

  it('does not publish when draft, pending, or image-preview state is unchanged', () => {
    const scopeKey = 'host\0wt\0tab'
    const pendingKey = `${scopeKey}\0session`
    act(() => {
      renderer = create(createElement(Retainer, { scopeKey }))
    })
    const afterMount = renderCount

    updateMobileNativeChatDraftText(retainedToken, '')
    updateMobileNativeChatSessionPending(retainedToken, pendingKey, (current) => current)
    migrateMobileNativeChatImagePreviewMessageIds(retainedToken, pendingKey, [])

    expect(renderCount).toBe(afterMount)
  })

  it('does not retain over-cap scopes after every active subscriber unmounts', async () => {
    const renderers: ReactTestRenderer[] = []
    const scopeKeys = Array.from({ length: 33 }, (_, index) => `host\0wt\0mounted-${index}`)

    for (const scopeKey of scopeKeys) {
      act(() => {
        renderers.push(create(createElement(Retainer, { scopeKey })))
      })
      const scope = ensureMobileNativeChatRuntimeScope(scopeKey)
      updateMobileNativeChatDraftText({ scopeKey, generation: scope.generation }, 'retained')
    }

    await act(async () => {
      for (const current of renderers) {
        current.unmount()
      }
      await Promise.resolve()
    })

    expect(
      scopeKeys.filter((scopeKey) => getMobileNativeChatRuntimeScope(scopeKey)).length
    ).toBeLessThanOrEqual(32)
  })

  it('keeps a just-rendered scope through release/setup while enforcing the cap', async () => {
    const renderers: ReactTestRenderer[] = []
    const scopeKeys = Array.from({ length: 32 }, (_, index) => `host\0wt\0switch-${index}`)

    for (const scopeKey of scopeKeys) {
      act(() => {
        renderers.push(create(createElement(Retainer, { scopeKey })))
      })
    }

    const nextScopeKey = 'host\0wt\0switch-next'
    await act(async () => {
      renderers[31]?.update(createElement(Retainer, { scopeKey: nextScopeKey }))
      await Promise.resolve()
    })

    expect(getMobileNativeChatRuntimeScope(nextScopeKey)).not.toBeNull()
    expect(getMobileNativeChatRuntimeScope(scopeKeys[31]!)).toBeNull()
  })
})
