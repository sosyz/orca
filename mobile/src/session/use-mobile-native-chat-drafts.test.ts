import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import {
  clearMobileNativeChatRuntimeStoreForTests,
  readMobileNativeChatPending,
  readMobileNativeChatSendError,
  releaseMobileNativeChatUnconfirmedSend,
  reserveMobileNativeChatUnconfirmedSend
} from './mobile-native-chat-runtime-store'
import {
  assistantTextMessage,
  createMobileNativeChatDraftsTestHarness,
  type MobileNativeChatDraftsTestHarness,
  PENDING_A,
  SCOPE_A,
  UNCONFIRMED_MESSAGE,
  userTextMessage
} from './mobile-native-chat-drafts-test-fixture'

describe('useMobileNativeChatDrafts composer edits', () => {
  let harness: MobileNativeChatDraftsTestHarness

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    harness = createMobileNativeChatDraftsTestHarness()
  })

  afterEach(() => {
    harness.unmount()
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('tracks each composer mutation with a stable route-owned generation', async () => {
    await harness.mount('a')
    const getter = harness.state!.getComposerEditGeneration
    const initial = getter()

    harness.state?.setComposerText('typed')
    expect(getter()).toBe(initial + 1)

    await harness.switchTo('b')
    harness.state?.setComposerText((current) => `${current} dictated`)
    expect(getter()).toBe(initial + 2)
  })

  it('does not clear a newer same-text or whitespace edit after an older send', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state!.captureSendOrigin('ping')!
    harness.state?.setComposerText('other')
    harness.state?.setComposerText('ping')
    harness.state?.clearDraftForSend(origin, 'ping')
    expect(harness.state?.composerText).toBe('ping')

    const newerOrigin = harness.state!.captureSendOrigin('ping')!
    harness.state?.setComposerText(' ping')
    harness.state?.clearDraftForSend(newerOrigin, 'ping')
    expect(harness.state?.composerText).toBe(' ping')
  })

  it('preserves an intentional clear after a newer edit while rejection is pending', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state!.captureSendOrigin('ping')!
    harness.state?.clearDraftForSend(origin, 'ping')
    harness.state?.setComposerText('newer edit')
    harness.state?.setComposerText('')
    harness.state?.restoreRejectedDraft(origin, 'ping')
    expect(harness.state?.composerText).toBe('')
  })

  it('does not restore an old rejected send over a draft edited after remount', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state!.captureSendOrigin('ping')!
    const restore = harness.state!.restoreRejectedDraft
    harness.state?.clearDraftForSend(origin, 'ping')
    harness.unmount()

    await harness.mount('a')
    harness.state?.setComposerText('newer edit')
    harness.state?.setComposerText('')
    restore(origin, 'ping')
    expect(harness.state?.composerText).toBe('')
  })
})

describe('useMobileNativeChatDrafts unconfirmed send lifecycle', () => {
  let harness: MobileNativeChatDraftsTestHarness

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    harness = createMobileNativeChatDraftsTestHarness()
  })

  afterEach(() => {
    harness.unmount()
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('registers no deadline when the transcript echo beat the ambiguous RPC rejection', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('m1', 'ping')]
      })
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      expect(vi.getTimerCount()).toBe(0)
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces uncertainty when no echo lands before the deadline', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      act(() => vi.advanceTimersByTime(19_999))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe(UNCONFIRMED_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not confirm an unconfirmed send against an older identical turn', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('old', 'ping')]
      })
      harness.state?.setComposerText('ping')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('old', 'ping'), assistantTextMessage('other', 'working')]
      })
      expect(harness.state?.composerText).toBe('ping')
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe(UNCONFIRMED_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not confirm an unconfirmed send when pagination prepends an older identical turn', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const anchor = assistantTextMessage('anchor', 'working')
      await harness.update({ tabId: 'a', messages: [anchor] })
      harness.state?.setComposerText('ping')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('older', 'ping'), anchor]
      })
      expect(harness.state?.composerText).toBe('ping')
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe(UNCONFIRMED_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires one new transcript echo per repeated unconfirmed send', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, 'first unconfirmed')
        harness.state?.holdUnconfirmedSend(origin, 'second unconfirmed')
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('echo-1', 'ping')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe('second unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fast-confirm duplicate delayed unknown callbacks from one echo', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const firstOrigin = reserveMobileNativeChatUnconfirmedSend(
        harness.state!.captureSendOrigin('ping')!
      )
      const secondOrigin = reserveMobileNativeChatUnconfirmedSend(
        harness.state!.captureSendOrigin('ping')!
      )
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('echo-1', 'ping')]
      })
      harness.state?.holdUnconfirmedSend(firstOrigin, 'first unconfirmed')
      releaseMobileNativeChatUnconfirmedSend(firstOrigin)
      harness.state?.holdUnconfirmedSend(secondOrigin, 'second unconfirmed')
      releaseMobileNativeChatUnconfirmedSend(secondOrigin)
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe('second unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps accepted duplicate pending when one historical echo only proves the unknown send', async () => {
    vi.useFakeTimers()
    try {
      const history = userTextMessage('history', 'ping')
      await harness.mount('a')
      await harness.update({ tabId: 'a', messages: [history] })
      const unknownOrigin = reserveMobileNativeChatUnconfirmedSend(
        harness.state!.captureSendOrigin('ping')!
      )
      const acceptedOrigin = reserveMobileNativeChatUnconfirmedSend(
        harness.state!.captureSendOrigin('ping')!
      )
      harness.state?.holdUnconfirmedSend(unknownOrigin, 'unknown duplicate')
      harness.state?.acceptSend(acceptedOrigin, 'ping')
      releaseMobileNativeChatUnconfirmedSend(unknownOrigin)
      releaseMobileNativeChatUnconfirmedSend(acceptedOrigin)
      const laterOrigin = reserveMobileNativeChatUnconfirmedSend(
        harness.state!.captureSendOrigin('ping')!
      )
      expect(laterOrigin.unconfirmedOccurrence).toBe(3)
      releaseMobileNativeChatUnconfirmedSend(laterOrigin)
      await harness.update({
        tabId: 'a',
        messages: [history, userTextMessage('echo-1', 'ping')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
      expect(readMobileNativeChatPending(SCOPE_A, PENDING_A).map((item) => item.text)).toEqual([
        'ping'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reuse one echo for repeated unknown sends after an assistant append', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, 'first unconfirmed')
        harness.state?.holdUnconfirmedSend(origin, 'second unconfirmed')
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('echo-1', 'ping')]
      })
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('echo-1', 'ping'), assistantTextMessage('a1', 'working')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe('second unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reuse one echo for repeated unknown sends after route remount', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, 'first unconfirmed')
        harness.state?.holdUnconfirmedSend(origin, 'second unconfirmed')
      }
      const echoedMessages = [userTextMessage('echo-1', 'ping')]
      await harness.update({ tabId: 'a', messages: echoedMessages })
      harness.unmount()
      await harness.mount('a', { messages: echoedMessages })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe('second unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps fallback unconfirmed ordinals above surviving repeated sends', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, 'first unconfirmed')
        harness.state?.holdUnconfirmedSend(origin, 'second unconfirmed')
      }
      const oneEcho = [userTextMessage('echo-1', 'ping')]
      await harness.update({ tabId: 'a', messages: oneEcho })
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, 'third unconfirmed')
      }
      await harness.update({
        tabId: 'a',
        messages: [...oneEcho, userTextMessage('echo-2', 'ping')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe('third unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a late ambiguous send data-scoped after unmount', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      const holdUnconfirmedSend = harness.state?.holdUnconfirmedSend
      harness.unmount()
      if (origin) {
        holdUnconfirmedSend?.(origin, UNCONFIRMED_MESSAGE)
      }
      expect(vi.getTimerCount()).toBe(1)
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
      await harness.mount('a')
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe(UNCONFIRMED_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })
})
