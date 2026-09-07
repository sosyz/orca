import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  HarmonyRouterProvider,
  Stack,
  useRouter
} from '../../harmony/src/navigation/harmony-router'
import {
  clearMobileNativeChatRuntimeStoreForTests,
  readMobileNativeChatSendError
} from './mobile-native-chat-runtime-store'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatSendError } from './use-mobile-native-chat-send-error'

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

const routeRegistry = vi.hoisted(() => ({
  matchRootRoute: vi.fn(),
  matchHostRoute: vi.fn()
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }
}))

vi.mock('../../harmony/node_modules/react-native/index.js', () => ({
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }
}))

vi.mock('../../harmony/node_modules/react/index.js', async () => {
  return vi.importActual<typeof import('react')>('react')
})

vi.mock('../../harmony/src/navigation/harmony-route-registry', () => ({
  matchHostRoute: routeRegistry.matchHostRoute,
  matchRootRoute: routeRegistry.matchRootRoute
}))

describe('mobile native-chat drafts on Harmony route remounts', () => {
  let renderer: ReactTestRenderer | null = null
  let router: ReturnType<typeof useRouter> | null = null
  let draftState: DraftState | null = null
  let sendErrorState: ReturnType<typeof useMobileNativeChatSendError> | null = null
  let sessionMessages: NativeChatMessage[] = []
  let sessionMounts = 0
  let sessionUnmounts = 0
  const showToast = vi.fn()
  const SCOPE = 'host\0worktree\0tab'
  const UNCONFIRMED_MESSAGE = 'Delivery unconfirmed — check chat before sending again'

  beforeEach(() => {
    clearMobileNativeChatRuntimeStoreForTests()
    showToast.mockClear()
    sessionMessages = []
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    router = null
    draftState = null
    sendErrorState = null
    sessionMounts = 0
    sessionUnmounts = 0
    sessionMessages = []
    routeRegistry.matchRootRoute.mockReset()
    routeRegistry.matchHostRoute.mockReset()
    clearMobileNativeChatRuntimeStoreForTests()
    vi.useRealTimers()
  })

  function userTextMessage(id: string, text: string): NativeChatMessage {
    return {
      id,
      role: 'user',
      blocks: [{ type: 'text', text }],
      timestamp: null,
      source: 'transcript'
    }
  }

  function HomeRoute(): null {
    router = useRouter()
    return null
  }

  function HostLayout(): React.JSX.Element {
    return createElement(Stack)
  }

  function SessionRoute(): null {
    router = useRouter()
    draftState = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'session',
      messages: sessionMessages,
      transcriptSettled: true
    })
    sendErrorState = useMobileNativeChatSendError({ scopeKey: SCOPE, showToast })
    sendErrorState.bannerMountedRef.current = true
    useEffect(() => {
      sessionMounts += 1
      return () => {
        sessionUnmounts += 1
      }
    }, [])
    return null
  }

  function FilesRoute(): null {
    router = useRouter()
    return null
  }

  function App(): React.JSX.Element {
    router = useRouter()
    return createElement(Stack)
  }

  function installRoutes(): void {
    routeRegistry.matchRootRoute.mockImplementation((pathname: string) =>
      pathname.startsWith('/h/')
        ? { component: HostLayout, name: 'h', params: {} }
        : { component: HomeRoute, name: 'index', params: {} }
    )
    routeRegistry.matchHostRoute.mockImplementation((pathname: string) => {
      if (/^\/h\/[^/]+\/session\/[^/]+$/.test(pathname)) {
        return {
          component: SessionRoute,
          name: '[hostId]/session/[worktreeId]',
          params: { hostId: 'host', worktreeId: 'worktree' }
        }
      }
      if (/^\/h\/[^/]+\/files\/[^/]+$/.test(pathname)) {
        return {
          component: FilesRoute,
          name: '[hostId]/files/[worktreeId]',
          params: { hostId: 'host', worktreeId: 'worktree' }
        }
      }
      return null
    })
  }

  async function renderApp(): Promise<void> {
    installRoutes()
    await act(async () => {
      renderer = create(createElement(HarmonyRouterProvider, null, createElement(App)))
    })
  }

  async function refreshApp(): Promise<void> {
    await act(async () => {
      renderer?.update(createElement(HarmonyRouterProvider, null, createElement(App)))
    })
  }

  it('keeps composer and accepted pending state after visiting a sibling host route', async () => {
    await renderApp()

    act(() => router!.push('/h/host/session/worktree'))
    act(() => draftState!.setComposerText('unsent draft'))
    const origin = draftState!.captureSendOrigin('sent before files')
    act(() => {
      draftState!.acceptSend(origin!, 'sent before files', ['file://preview.png'])
    })
    expect(sessionMounts).toBe(1)
    expect(draftState!.composerText).toBe('unsent draft')
    expect(draftState!.pending.map((item) => item.text)).toEqual(['sent before files'])

    act(() => router!.push('/h/host/files/worktree'))
    expect(sessionUnmounts).toBe(1)

    act(() => router!.back())
    expect(sessionMounts).toBe(2)
    expect({
      composerText: draftState!.composerText,
      pendingImages: draftState!.pending.map((item) => item.images ?? []),
      pendingTexts: draftState!.pending.map((item) => item.text)
    }).toEqual({
      composerText: 'unsent draft',
      pendingImages: [['file://preview.png']],
      pendingTexts: ['sent before files']
    })
  })

  it('shows a late accepted pending send after the session route remounts', async () => {
    await renderApp()
    act(() => router!.push('/h/host/session/worktree'))
    const origin = draftState!.captureSendOrigin('sent while leaving')
    const acceptAfterUnmount = draftState!.acceptSend

    act(() => router!.push('/h/host/files/worktree'))
    expect(sessionUnmounts).toBe(1)
    act(() => acceptAfterUnmount(origin!, 'sent while leaving', ['file://preview.png']))
    act(() => router!.back())

    expect(draftState!.pending.map((item) => item.text)).toEqual(['sent while leaving'])
    expect(draftState!.pending.map((item) => item.images ?? [])).toEqual([['file://preview.png']])
  })

  it('restores a late rejected draft and shows its error after remount', async () => {
    await renderApp()
    act(() => router!.push('/h/host/session/worktree'))
    act(() => draftState!.setComposerText('send me'))
    const origin = draftState!.captureSendOrigin('send me')
    const restoreAfterUnmount = draftState!.restoreRejectedDraft
    const showAfterUnmount = sendErrorState!.show
    act(() => draftState!.clearDraftForSend(origin!, 'send me'))

    act(() => router!.push('/h/host/files/worktree'))
    act(() => {
      restoreAfterUnmount(origin!, 'send me')
      showAfterUnmount('Message not sent')
    })
    act(() => router!.back())

    expect(showToast).not.toHaveBeenCalled()
    expect(draftState!.composerText).toBe('send me')
    expect(sendErrorState!.message).toBe('Message not sent')
  })

  it('surfaces an unknown send if the deadline passes after returning before it', async () => {
    vi.useFakeTimers()
    await renderApp()
    act(() => router!.push('/h/host/session/worktree'))
    const origin = draftState!.captureSendOrigin('late unknown')
    const holdAfterUnmount = draftState!.holdUnconfirmedSend

    act(() => router!.push('/h/host/files/worktree'))
    act(() => holdAfterUnmount(origin!, UNCONFIRMED_MESSAGE))
    act(() => router!.back())
    expect(sendErrorState!.message).toBeNull()

    act(() => vi.advanceTimersByTime(20_000))

    expect(sendErrorState!.message).toBe(UNCONFIRMED_MESSAGE)
  })

  it('shows then clears an unknown send that expired before return once its echo settles', async () => {
    vi.useFakeTimers()
    await renderApp()
    act(() => router!.push('/h/host/session/worktree'))
    const origin = draftState!.captureSendOrigin('late unknown')
    const holdAfterUnmount = draftState!.holdUnconfirmedSend

    act(() => router!.push('/h/host/files/worktree'))
    act(() => holdAfterUnmount(origin!, UNCONFIRMED_MESSAGE))
    act(() => vi.advanceTimersByTime(20_000))
    expect(readMobileNativeChatSendError(SCOPE)).toBeNull()

    act(() => router!.back())
    expect(sendErrorState!.message).toBe(UNCONFIRMED_MESSAGE)

    sessionMessages = [userTextMessage('u1', 'late unknown')]
    await refreshApp()

    expect(sendErrorState!.message).toBeNull()
  })
})
