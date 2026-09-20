import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('./mobile-native-chat-landed-preview-budget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-native-chat-landed-preview-budget')>()
  return {
    ...actual,
    MOBILE_NATIVE_CHAT_LANDED_PREVIEW_CHAR_BUDGET: 80,
    applyLandedImagePreviewDataUriBudget: vi.fn(actual.applyLandedImagePreviewDataUriBudget)
  }
})

import { applyLandedImagePreviewDataUriBudget } from './mobile-native-chat-landed-preview-budget'
import {
  appendMobileNativeChatAttachments,
  appendMobileNativeChatPendingMessage,
  clearMobileNativeChatRuntimeStoreForTests,
  ensureMobileNativeChatRuntimeScope,
  getMobileNativeChatRuntimeScope,
  mergeMobileNativeChatLandedImagePreviewEchoes,
  migrateMobileNativeChatImagePreviewMessageIds,
  readMobileNativeChatAttachments,
  readMobileNativeChatImagePreviews,
  readMobileNativeChatPending,
  updateMobileNativeChatDraftText,
  useMobileNativeChatRuntimeScopeToken,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'

const inline = (letter: string) => `data:image/png;base64,${letter.repeat(18)}`

function tokenFor(scopeKey: string): MobileNativeChatRuntimeScopeToken {
  const scope = ensureMobileNativeChatRuntimeScope(scopeKey)
  return { scopeKey, generation: scope.generation }
}

function textMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('landed image previews in the native-chat runtime', () => {
  const renderers: ReactTestRenderer[] = []
  const renders = { a: 0, b: 0 }

  function Observe({ scopeKey, owner }: { scopeKey: string; owner: 'a' | 'b' }): null {
    useMobileNativeChatRuntimeScopeToken(scopeKey)
    renders[owner] += 1
    return null
  }

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    vi.mocked(applyLandedImagePreviewDataUriBudget).mockClear()
    renders.a = 0
    renders.b = 0
  })

  afterEach(() => {
    act(() => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount()
      }
    })
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it('evicts the older landed scope and notifies it once, keeping pending and attachments', () => {
    const a = 'host\0wt\0a'
    const b = 'host\0wt\0b'
    const sessionA = `${a}\0session`
    const sessionB = `${b}\0session`
    act(() => {
      renderers.push(create(createElement(Observe, { scopeKey: a, owner: 'a' })))
      renderers.push(create(createElement(Observe, { scopeKey: b, owner: 'b' })))
    })
    const tokenA = tokenFor(a)
    const tokenB = tokenFor(b)
    const pendingImage = inline('p')
    appendMobileNativeChatPendingMessage(
      {
        draftKey: a,
        pendingKey: sessionA,
        scopeGeneration: tokenA.generation,
        normalizedText: '',
        baselineOccurrences: 0,
        baselineTailMessageId: null,
        baselineResolved: true
      },
      '',
      [pendingImage]
    )
    appendMobileNativeChatAttachments(tokenA, [
      { path: '/tmp/unsent.png', previewUri: pendingImage }
    ])

    const untouchedB = getMobileNativeChatRuntimeScope(b)!.imagePreviewsBySession
    const beforeA = { ...renders }
    act(() =>
      mergeMobileNativeChatLandedImagePreviewEchoes(tokenA, sessionA, [
        { pendingId: 'a1', messageId: 'a1', images: [inline('a')] }
      ])
    )
    expect(renders.a).toBe(beforeA.a + 1)
    expect(renders.b).toBe(beforeA.b)
    expect(getMobileNativeChatRuntimeScope(b)!.imagePreviewsBySession).toBe(untouchedB)

    const underBudgetA = getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession
    const beforeB = { ...renders }
    act(() =>
      mergeMobileNativeChatLandedImagePreviewEchoes(tokenB, sessionB, [
        { pendingId: 'b1', messageId: 'b1', images: [inline('b')] }
      ])
    )
    expect(renders.a).toBe(beforeB.a)
    expect(renders.b).toBe(beforeB.b + 1)
    expect(getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession).toBe(underBudgetA)
    const stableA = getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession
    const stableB = getMobileNativeChatRuntimeScope(b)!.imagePreviewsBySession
    const scansBeforeDraft = vi.mocked(applyLandedImagePreviewDataUriBudget).mock.calls.length
    act(() => updateMobileNativeChatDraftText(tokenA, 'typing'))
    expect(vi.mocked(applyLandedImagePreviewDataUriBudget).mock.calls).toHaveLength(
      scansBeforeDraft
    )
    expect(getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession).toBe(stableA)
    expect(getMobileNativeChatRuntimeScope(b)!.imagePreviewsBySession).toBe(stableB)

    const before = { ...renders }
    act(() =>
      mergeMobileNativeChatLandedImagePreviewEchoes(tokenA, sessionA, [
        { pendingId: 'a2', messageId: 'a2', images: [inline('c')] }
      ])
    )

    expect(readMobileNativeChatImagePreviews(sessionB)).toEqual({ b1: [''] })
    expect(readMobileNativeChatImagePreviews(sessionA)).toEqual({
      a1: [inline('a')],
      a2: [inline('c')]
    })
    expect(renders.a).toBe(before.a + 1)
    expect(renders.b).toBe(before.b + 1)
    expect(readMobileNativeChatPending(a, sessionA)[0]?.images).toEqual([pendingImage])
    expect(readMobileNativeChatAttachments(a)[0]?.previewUri).toBe(pendingImage)
  })

  it('checks a changed migration, preserves order, and skips no-op migrations', () => {
    const a = 'host\0wt\0migrate'
    const session = `${a}\0session`
    const token = tokenFor(a)
    // Simulate landed entries retained before the budget existed.
    getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession = {
      [session]: {
        prompt: [inline('p')],
        source: [inline('s')],
        other: [inline('o')]
      }
    }
    const messages = [
      textMessage('source', '[Image: source: /tmp/source.png]'),
      textMessage('prompt', '[Image #1]')
    ]
    expect(vi.mocked(applyLandedImagePreviewDataUriBudget)).not.toHaveBeenCalled()

    migrateMobileNativeChatImagePreviewMessageIds(token, session, messages)
    expect(readMobileNativeChatImagePreviews(session)).toEqual({
      prompt: ['', inline('s')],
      other: [inline('o')]
    })
    expect(vi.mocked(applyLandedImagePreviewDataUriBudget)).toHaveBeenCalledOnce()

    const previews = getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession
    migrateMobileNativeChatImagePreviewMessageIds(token, session, messages)
    expect(getMobileNativeChatRuntimeScope(a)!.imagePreviewsBySession).toBe(previews)
    expect(vi.mocked(applyLandedImagePreviewDataUriBudget)).toHaveBeenCalledOnce()
  })
})
