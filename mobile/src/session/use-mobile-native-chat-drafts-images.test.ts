import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import { clearMobileNativeChatRuntimeStoreForTests } from './mobile-native-chat-runtime-store'
import {
  assistantTextMessage,
  createMobileNativeChatDraftsTestHarness,
  type MobileNativeChatDraftsTestHarness,
  SCOPE_A,
  UNCONFIRMED_MESSAGE,
  userTextMessage
} from './mobile-native-chat-drafts-test-fixture'
import { readMobileNativeChatSendError } from './mobile-native-chat-runtime-store'

describe('useMobileNativeChatDrafts image reconciliation', () => {
  let harness: MobileNativeChatDraftsTestHarness

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    harness = createMobileNativeChatDraftsTestHarness()
  })

  afterEach(() => {
    harness.unmount()
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('keeps an image-only echo through an agent reply, clearing only when the user turn lands', async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi')]
    })
    const origin = harness.state?.captureSendOrigin('')
    if (origin) {
      harness.state?.acceptSend(origin, '', ['file:///a.jpg'])
    }
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([['file:///a.jpg']])

    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi'), assistantTextMessage('a2', 'nice photo')]
    })
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([['file:///a.jpg']])

    await harness.update({
      tabId: 'a',
      messages: [
        assistantTextMessage('a1', 'hi'),
        assistantTextMessage('a2', 'nice photo'),
        userTextMessage('u1', '[Image: source: /tmp/a.png]')
      ]
    })
    expect(harness.state?.pending).toEqual([])
    expect(harness.state?.imagePreviewsByMessageId).toEqual({
      u1: ['file:///a.jpg']
    })
  })

  it("keeps an image-only echo when an unrelated text send's echo lands", async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi')]
    })
    const textOrigin = harness.state?.captureSendOrigin('ping')
    const imageOrigin = harness.state?.captureSendOrigin('')
    if (textOrigin && imageOrigin) {
      harness.state?.acceptSend(textOrigin, 'ping')
      harness.state?.acceptSend(imageOrigin, '', ['file:///a.jpg'])
    }
    expect(harness.state?.pending).toHaveLength(2)

    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi'), userTextMessage('u1', 'ping')]
    })
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([['file:///a.jpg']])

    await harness.update({
      tabId: 'a',
      messages: [
        assistantTextMessage('a1', 'hi'),
        userTextMessage('u1', 'ping'),
        userTextMessage('u2', '[Image: source: /tmp/a.png]')
      ]
    })
    expect(harness.state?.pending).toEqual([])
  })

  it('reconciles a captioned image echo that carries the [Image #N] marker', async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi')]
    })
    const origin = harness.state?.captureSendOrigin('look at this')
    if (origin) {
      harness.state?.acceptSend(origin, 'look at this', ['file:///a.jpg'])
    }
    await harness.update({
      tabId: 'a',
      messages: [
        assistantTextMessage('a1', 'hi'),
        userTextMessage('u1', '[Image: source: /tmp/a.png]'),
        userTextMessage('u2', '[Image #1] look at this')
      ]
    })
    expect(harness.state?.pending).toEqual([])
    expect(harness.state?.imagePreviewsByMessageId).toEqual({
      u2: ['file:///a.jpg']
    })
  })

  it('reconciles a captioned image echo with a trailing [Image #N] marker', async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi')]
    })
    const origin = harness.state?.captureSendOrigin('look at this')
    if (origin) {
      harness.state?.acceptSend(origin, 'look at this', ['file:///a.jpg'])
    }
    await harness.update({
      tabId: 'a',
      messages: [
        assistantTextMessage('a1', 'hi'),
        userTextMessage('u1', '[Image: source: /tmp/a.png]'),
        userTextMessage('u2', 'look at this[Image #1]')
      ]
    })
    expect(harness.state?.pending).toEqual([])
    expect(harness.state?.imagePreviewsByMessageId).toEqual({
      u2: ['file:///a.jpg']
    })
  })

  it('hands a marker-only image preview to the authoritative user bubble', async () => {
    await harness.mount('a')
    const origin = harness.state?.captureSendOrigin('')
    if (origin) {
      harness.state?.acceptSend(origin, '', ['file:///a.jpg'])
    }
    await harness.update({
      tabId: 'a',
      messages: [userTextMessage('u1', '[Image #1]')]
    })
    expect(harness.state?.pending).toEqual([])
    expect(harness.state?.imagePreviewsByMessageId).toEqual({
      u1: ['file:///a.jpg']
    })
  })

  it('reconciles an image-only unconfirmed send against the next user turn without warning', async () => {
    vi.useFakeTimers()
    try {
      await harness.mount('a')
      await harness.update({
        tabId: 'a',
        messages: [assistantTextMessage('a1', 'hi')]
      })
      const origin = harness.state?.captureSendOrigin('')
      if (origin) {
        harness.state?.holdUnconfirmedSend(origin, UNCONFIRMED_MESSAGE)
      }
      await harness.update({
        tabId: 'a',
        messages: [assistantTextMessage('a1', 'hi'), assistantTextMessage('a2', 'ok')]
      })
      await harness.update({
        tabId: 'a',
        messages: [
          assistantTextMessage('a1', 'hi'),
          assistantTextMessage('a2', 'ok'),
          userTextMessage('u1', '')
        ]
      })
      act(() => vi.advanceTimersByTime(30_000))
      expect(readMobileNativeChatSendError(SCOPE_A)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears image-only echoes one per landed user turn, not all at once', async () => {
    await harness.mount('a')
    await harness.update({
      tabId: 'a',
      messages: [assistantTextMessage('a1', 'hi')]
    })
    const origin = harness.state?.captureSendOrigin('')
    if (origin) {
      harness.state?.acceptSend(origin, '', ['file:///a.jpg'])
      harness.state?.acceptSend(origin, '', ['file:///b.jpg'])
    }
    expect(harness.state?.pending).toHaveLength(2)
    await harness.update({
      tabId: 'a',
      messages: [
        assistantTextMessage('a1', 'hi'),
        userTextMessage('u1', '[Image: source: /tmp/a.png]')
      ]
    })
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([['file:///b.jpg']])
  })

  it('preserves first-send images through session assignment and transcript replacement', async () => {
    await harness.mount('a', { sessionId: null })
    const images = ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg']
    harness.state?.setComposerText('look')
    const origin = harness.state?.captureSendOrigin('look')
    expect(origin).toMatchObject({ pendingKey: null })
    if (origin) {
      harness.state?.clearDraftForSend(origin, 'look')
      harness.state?.acceptSend(origin, 'look', images)
    }
    expect(harness.state?.composerText).toBe('')
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([images])

    await harness.update({ tabId: 'a', sessionId: 'assigned' })
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([images])
    await harness.update({
      tabId: 'a',
      sessionId: 'assigned',
      messages: [
        userTextMessage('source-1', '[Image: source: /tmp/a.png]'),
        userTextMessage('source-2', '[Image: source: /tmp/b.png]'),
        userTextMessage('source-3', '[Image: source: /tmp/c.png]')
      ]
    })
    expect(harness.state?.pending.map((pending) => pending.images)).toEqual([images])
    await harness.update({
      tabId: 'a',
      sessionId: 'assigned',
      messages: [
        userTextMessage('source-1', '[Image: source: /tmp/a.png]'),
        userTextMessage('source-2', '[Image: source: /tmp/b.png]'),
        userTextMessage('source-3', '[Image: source: /tmp/c.png]'),
        userTextMessage('prompt', '[Image #1] [Image #2] [Image #3] look')
      ]
    })
    expect(harness.state?.pending).toEqual([])
    expect(harness.state?.imagePreviewsByMessageId).toEqual({ prompt: images })
  })
})
