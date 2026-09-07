import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import { clearMobileNativeChatRuntimeStoreForTests } from './mobile-native-chat-runtime-store'
import {
  createMobileNativeChatDraftsTestHarness,
  type MobileNativeChatDraftsTestHarness,
  UNCONFIRMED_MESSAGE,
  userTextMessage
} from './mobile-native-chat-drafts-test-fixture'

describe('useMobileNativeChatDrafts composer send lifecycle', () => {
  let harness: MobileNativeChatDraftsTestHarness

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    harness = createMobileNativeChatDraftsTestHarness()
  })

  afterEach(() => {
    harness.unmount()
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('keeps drafts and accepted pending messages on their originating tabs', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('from a')
    const originA = harness.state?.captureSendOrigin('from a')
    expect(originA).not.toBeNull()
    if (originA) {
      harness.state?.clearDraftForSend(originA, 'from a')
    }

    await harness.switchTo('b')
    harness.state?.setComposerText('from b')
    if (originA) {
      harness.state?.acceptSend(originA, 'from a')
    }
    expect(harness.state?.composerText).toBe('from b')
    expect(harness.state?.pending).toEqual([])

    await harness.switchTo('a')
    expect(harness.state?.composerText).toBe('')
    expect(harness.state?.pending.map((pending) => pending.text)).toEqual(['from a'])
  })

  it('clears the composer at send time, before the RPC settles', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state?.captureSendOrigin('ping')
    if (origin) {
      harness.state?.clearDraftForSend(origin, 'ping')
    }
    expect(harness.state?.composerText).toBe('')
  })

  it('restores the text on a definite rejection', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state?.captureSendOrigin('ping')
    if (origin) {
      harness.state?.clearDraftForSend(origin, 'ping')
      harness.state?.restoreRejectedDraft(origin, 'ping')
    }
    expect(harness.state?.composerText).toBe('ping')
  })

  it('does not clobber newer edits when restoring a rejected send', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('ping')
    const origin = harness.state?.captureSendOrigin('ping')
    if (origin) {
      harness.state?.clearDraftForSend(origin, 'ping')
    }
    harness.state?.setComposerText('newer edit')
    if (origin) {
      harness.state?.restoreRejectedDraft(origin, 'ping')
    }
    expect(harness.state?.composerText).toBe('newer edit')
  })

  it('restores a rejected send onto its originating tab only', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('from a')
    const originA = harness.state?.captureSendOrigin('from a')
    if (originA) {
      harness.state?.clearDraftForSend(originA, 'from a')
    }

    await harness.switchTo('b')
    if (originA) {
      harness.state?.restoreRejectedDraft(originA, 'from a')
    }
    expect(harness.state?.composerText).toBe('')

    await harness.switchTo('a')
    expect(harness.state?.composerText).toBe('from a')
  })

  it('keeps the composer clear when the echo lands after the unconfirmed deadline', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      harness.state?.setComposerText('ping')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.clearDraftForSend(origin, 'ping')
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      expect(harness.state?.composerText).toBe('')
      act(() => vi.advanceTimersByTime(25_000))
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('m1', 'ping')]
      })
      expect(harness.state?.composerText).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears one pending per landed message so duplicate sends are not all dropped', async () => {
    await harness.mount('a')
    const origin = harness.state?.captureSendOrigin('ping')
    if (origin) {
      harness.state?.acceptSend(origin, 'ping')
      harness.state?.acceptSend(origin, 'ping')
    }
    expect(harness.state?.pending.map((pending) => pending.text)).toEqual(['ping', 'ping'])
    await harness.update({
      tabId: 'a',
      messages: [userTextMessage('m1', 'ping')]
    })
    expect(harness.state?.pending.map((pending) => pending.text)).toEqual(['ping'])
  })
})
