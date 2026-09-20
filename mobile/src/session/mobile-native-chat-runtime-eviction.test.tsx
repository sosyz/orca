import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import {
  appendMobileNativeChatAttachments,
  appendMobileNativeChatPendingMessage,
  appendMobileNativeChatUnconfirmedSend,
  beginMobileNativeChatImageAttach,
  clearMobileNativeChatRuntimeStoreForTests,
  ensureMobileNativeChatRuntimeScope,
  getMobileNativeChatRuntimeScope,
  reserveMobileNativeChatUnconfirmedSend,
  setMobileNativeChatLaunchDraftSeed,
  writeMobileNativeChatRuntimeScope,
  type MobileNativeChatRuntimeScopeToken
} from './mobile-native-chat-runtime-store'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

const key = (index: number) => `host\0worktree-${index}\0tab`
const messages: [] = []
type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
type Scenario = {
  name: string
  seed: (
    drafts: Drafts,
    token: MobileNativeChatRuntimeScopeToken,
    origin: MobileNativeChatSendOrigin
  ) => void
}
const scenarios: Scenario[] = [
  { name: 'unsent text', seed: (drafts) => drafts.setComposerText('irreplaceable draft') },
  {
    name: 'unsent attachment',
    seed: (_, token) =>
      appendMobileNativeChatAttachments(token, [
        { path: '/virtual/host/image', previewUri: 'file://virtual/image' }
      ])
  },
  { name: 'pending image upload', seed: (_, token) => beginMobileNativeChatImageAttach(token) },
  {
    name: 'unconfirmed delivery',
    seed: (_, __, origin) =>
      appendMobileNativeChatUnconfirmedSend(origin, 'Delivery unconfirmed', 20_000)
  },
  {
    name: 'in-flight send reservation',
    seed: (_, __, origin) => {
      reserveMobileNativeChatUnconfirmedSend(origin)
    }
  },
  {
    name: 'unmatched accepted echo',
    seed: (_, __, origin) => appendMobileNativeChatPendingMessage(origin, 'accepted')
  },
  {
    name: 'accepted image before session discovery',
    seed: (_, __, origin) =>
      appendMobileNativeChatPendingMessage({ ...origin, pendingKey: null }, '', [
        'file://virtual/image'
      ])
  },
  {
    name: 'parked launch input',
    seed: (_, token) =>
      setMobileNativeChatLaunchDraftSeed(token, { text: 'parked input', createdAt: 1 })
  }
]

describe('native-chat scope eviction priorities', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts!: Drafts
  function Session({ index }: { index: number }) {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: `worktree-${index}`,
      tabId: 'tab',
      sessionId: 'session',
      messages,
      transcriptSettled: true,
      chatActive: false
    })
    return null
  }
  function visit(index: number) {
    act(() => {
      const route = createElement(Session, { key: index, index })
      if (renderer) {
        renderer.update(route)
      } else {
        renderer = create(route)
      }
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    clearMobileNativeChatRuntimeStoreForTests()
  })

  it.each(scenarios)('retains $name while empty sessions turn over', ({ name, seed }) => {
    visit(0)
    const original = ensureMobileNativeChatRuntimeScope(key(0))
    const token = { scopeKey: key(0), generation: original.generation }
    const origin = drafts.captureSendOrigin('accepted')!
    act(() => seed(drafts, token, origin))
    for (let index = 1; index <= 33; index++) {
      visit(index)
    }
    expect(getMobileNativeChatRuntimeScope(key(0))).toBe(original)
    expect(
      Array.from({ length: 34 }, (_, index) => getMobileNativeChatRuntimeScope(key(index))).filter(
        Boolean
      )
    ).toHaveLength(32)
    visit(0)
    expect(getMobileNativeChatRuntimeScope(key(0))).toBe(original)
    if (name === 'unsent text') {
      expect(drafts.composerText).toBe('irreplaceable draft')
    }
  })

  it('prefers already-landed preview cache over an older unsent draft', () => {
    visit(0)
    act(() => drafts.setComposerText('keep this'))
    const original = getMobileNativeChatRuntimeScope(key(0))
    visit(1)
    const scope = ensureMobileNativeChatRuntimeScope(key(1))
    act(() =>
      writeMobileNativeChatRuntimeScope(
        { scopeKey: key(1), generation: scope.generation },
        (current) => {
          current.imagePreviewsBySession = { session: { message: ['file://virtual/landed'] } }
          return true
        }
      )
    )
    for (let index = 2; index <= 32; index++) {
      visit(index)
    }
    expect(getMobileNativeChatRuntimeScope(key(0))).toBe(original)
    expect(getMobileNativeChatRuntimeScope(key(1))).toBeNull()
  })

  it('keeps a declined launch sentinel ahead of empty caches', () => {
    visit(0)
    const original = ensureMobileNativeChatRuntimeScope(key(0))
    act(() =>
      setMobileNativeChatLaunchDraftSeed(
        { scopeKey: key(0), generation: original.generation },
        null
      )
    )
    for (let index = 1; index <= 33; index++) {
      visit(index)
    }
    expect(getMobileNativeChatRuntimeScope(key(0))).toBe(original)
  })

  it('evicts a launch sentinel before a real draft when no empty candidate remains', () => {
    visit(0)
    act(() => drafts.setComposerText('oldest real draft'))
    const original = getMobileNativeChatRuntimeScope(key(0))
    visit(1)
    const sentinel = ensureMobileNativeChatRuntimeScope(key(1))
    act(() =>
      setMobileNativeChatLaunchDraftSeed(
        { scopeKey: key(1), generation: sentinel.generation },
        null
      )
    )
    for (let index = 2; index <= 31; index++) {
      visit(index)
      act(() => drafts.setComposerText(`draft-${index}`))
    }
    visit(32)
    expect(getMobileNativeChatRuntimeScope(key(0))).toBe(original)
    expect(getMobileNativeChatRuntimeScope(key(1))).toBeNull()
  })
})
