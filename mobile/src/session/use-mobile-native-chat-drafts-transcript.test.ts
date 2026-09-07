import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import {
  clearMobileNativeChatRuntimeStoreForTests,
  readMobileNativeChatSendError
} from './mobile-native-chat-runtime-store'
import {
  assistantTextMessage,
  createMobileNativeChatDraftsTestHarness,
  type MobileNativeChatDraftsTestHarness,
  SCOPE_A,
  UNCONFIRMED_MESSAGE,
  userTextMessage
} from './mobile-native-chat-drafts-test-fixture'

describe('useMobileNativeChatDrafts transcript reconciliation', () => {
  let harness: MobileNativeChatDraftsTestHarness

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    harness = createMobileNativeChatDraftsTestHarness()
  })

  afterEach(() => {
    harness.unmount()
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('does not reconcile a repeated send against an older identical turn', async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [userTextMessage('old', 'ping')]
    })
    const origin = harness.state?.captureSendOrigin('ping')
    if (origin) {
      harness.state?.acceptSend(origin, 'ping')
    }

    await harness.update({
      tabId: 'a',
      messages: [userTextMessage('old', 'ping'), assistantTextMessage('other', 'working')]
    })
    expect(harness.state?.pending.map((pending) => pending.text)).toEqual(['ping'])

    await harness.update({
      tabId: 'a',
      messages: [
        userTextMessage('old', 'ping'),
        assistantTextMessage('other', 'working'),
        userTextMessage('new', 'ping')
      ]
    })
    expect(harness.state?.pending).toEqual([])
  })

  it('does not erase newer edits when an older send clears', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('submitted')
    const origin = harness.state?.captureSendOrigin('submitted')
    harness.state?.setComposerText('new edit')
    if (origin) {
      harness.state?.clearDraftForSend(origin, 'submitted')
    }
    expect(harness.state?.composerText).toBe('new edit')
  })

  it('stays quiet when an unconfirmed send lands in the transcript', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('m1', 'ping')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rechecks an unconfirmed send when a same-id transcript row updates to the echo', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('m1', 'partial')]
      })
      await harness.update({
        tabId: 'a',
        messages: [userTextMessage('m1', 'ping')]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not erase newer edits when an unconfirmed send lands', async () => {
    await harness.mount('a')
    harness.state?.setComposerText('submitted')
    const origin = harness.state?.captureSendOrigin('submitted')
    if (origin) {
      harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
    }
    harness.state?.setComposerText('new edit')
    await harness.update({
      tabId: 'a',
      messages: [userTextMessage('m1', 'submitted')]
    })
    expect(harness.state?.composerText).toBe('new edit')
  })

  it('does not confirm an old session send from an identical turn in its replacement', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      harness.state?.setComposerText('ping')
      const origin = harness.state?.captureSendOrigin('ping')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        sessionId: 'replacement',
        messages: [userTextMessage('replacement-message', 'ping')]
      })
      expect(harness.state?.composerText).toBe('ping')
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)?.message).toBe(UNCONFIRMED_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })
})
