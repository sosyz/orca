import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

export type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

export type DraftHarnessRenderProps = {
  tabId: string
  sessionId?: string | null
  messages?: NativeChatMessage[]
  launchDraft?: string | null
  chatActive?: boolean
  transcriptLoading?: boolean
  transcriptSettled?: boolean
}

export type MobileNativeChatDraftsTestHarness = {
  readonly state: DraftState | null
  readonly mount: (tabId: string, options?: Omit<DraftHarnessRenderProps, 'tabId'>) => Promise<void>
  readonly update: (props: DraftHarnessRenderProps) => Promise<void>
  readonly switchTo: (tabId: string) => Promise<void>
  readonly unmount: () => void
}

function invokeInAct<T>(callback: () => T): T {
  let result!: T
  act(() => {
    result = callback()
  })
  return result
}

function actStateMethods(state: DraftState): DraftState {
  return new Proxy(state, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => invokeInAct(() => Reflect.apply(value, target, args))
    }
  })
}

export const SCOPE_A = 'host\0worktree\0a'
export const PENDING_A = `${SCOPE_A}\0session-a`
export const UNCONFIRMED_MESSAGE = 'Delivery unconfirmed — check chat before sending again'

export function userTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

export function assistantTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

export function createMobileNativeChatDraftsTestHarness(): MobileNativeChatDraftsTestHarness {
  let renderer: ReactTestRenderer | null = null
  let currentState: DraftState | null = null

  function Harness({
    tabId,
    sessionId = `session-${tabId}`,
    messages = [],
    launchDraft = null,
    chatActive = true,
    transcriptLoading = false,
    transcriptSettled = !transcriptLoading
  }: DraftHarnessRenderProps): null {
    const nextState = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId,
      messages,
      launchDraft,
      chatActive,
      transcriptLoading,
      transcriptSettled
    })
    useEffect(() => {
      currentState = nextState
    }, [nextState])
    return null
  }

  return {
    get state() {
      return currentState ? actStateMethods(currentState) : null
    },
    mount: async (tabId, options = {}) => {
      await act(async () => {
        renderer = create(createElement(Harness, { tabId, ...options }))
      })
    },
    update: async (props) => {
      await act(async () => renderer?.update(createElement(Harness, props)))
    },
    switchTo: async (tabId) => {
      await act(async () => renderer?.update(createElement(Harness, { tabId })))
    },
    unmount: () => {
      act(() => renderer?.unmount())
      renderer = null
      currentState = null
    }
  }
}
