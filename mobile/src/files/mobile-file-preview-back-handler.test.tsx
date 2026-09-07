import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileFilePreviewScreen } from './MobileFilePreviewScreen'

type BodyProps = {
  editable: boolean
  draftContent: string
  onDraftChange: (content: string) => void
}

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  bodyProps: [] as BodyProps[],
  client: {},
  forceReconnect: vi.fn(),
  loadMobileFilePreview: vi.fn(async () => ({
    status: 'ready' as const,
    kind: 'text' as const,
    content: 'saved',
    truncated: false,
    byteLength: 5
  })),
  routeBackHandler: null as (() => boolean) | null,
  routerBack: vi.fn(),
  unregisterRouteBackHandler: vi.fn()
}))

const navigationMock = vi.hoisted(() => ({
  registerBackHandler: vi.fn((handler: () => boolean) => {
    mocks.routeBackHandler = handler
    return () => {
      if (mocks.routeBackHandler === handler) {
        mocks.routeBackHandler = null
      }
      mocks.unregisterRouteBackHandler()
    }
  })
}))

vi.mock('expo-router', () => ({
  useNavigation: () => navigationMock,
  useRouter: () => ({ back: mocks.routerBack })
}))

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Pressable: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('Pressable', props, children),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('Text', props, children),
  View: ({ children, ...props }: { children?: ReactNode }) => createElement('View', props, children)
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('SafeAreaView', props, children)
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Save: 'Save'
}))

vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isLandscape: false })
}))

vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => mocks.forceReconnect,
  useHostClient: () => ({ client: mocks.client, state: 'connected' })
}))

vi.mock('./mobile-file-preview-request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-file-preview-request')>()
  return {
    ...actual,
    loadMobileFilePreview: mocks.loadMobileFilePreview,
    saveMobileTerminalArtifactPreview: vi.fn()
  }
})

vi.mock('./MobileFilePreviewBody', () => ({
  MobileFilePreviewBody: (props: BodyProps) => {
    mocks.bodyProps.push(props)
    return null
  }
}))

describe('MobileFilePreviewScreen back handling', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.alert.mockClear()
    mocks.bodyProps.length = 0
    mocks.forceReconnect.mockClear()
    mocks.loadMobileFilePreview.mockClear()
    mocks.routeBackHandler = null
    mocks.routerBack.mockClear()
    mocks.unregisterRouteBackHandler.mockClear()
    navigationMock.registerBackHandler.mockClear()
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('keeps dirty terminal artifact drafts behind the route-owned back prompt', async () => {
    await act(async () => {
      renderer = create(
        createElement(MobileFilePreviewScreen, {
          route: {
            ok: true,
            params: {
              absolutePath: '/tmp/result.txt',
              grantId: 'grant-1',
              hostId: 'host-1',
              source: 'terminalArtifact',
              worktreeId: 'wt-1'
            }
          }
        })
      )
    })

    const readyBody = mocks.bodyProps.at(-1)!
    expect(readyBody.editable).toBe(true)
    expect(readyBody.draftContent).toBe('saved')
    expect(navigationMock.registerBackHandler).toHaveBeenCalled()

    act(() => readyBody.onDraftChange('changed'))

    let handled = false
    act(() => {
      handled = mocks.routeBackHandler?.() ?? false
    })

    expect(handled).toBe(true)
    expect(mocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Unsaved edits will be lost.',
      expect.any(Array)
    )
    expect(mocks.routerBack).not.toHaveBeenCalled()

    const actions = mocks.alert.mock.calls[0]?.[2] as
      | Array<{ text: string; onPress?: () => void }>
      | undefined
    actions?.find((action) => action.text === 'Stay')?.onPress?.()
    expect(mocks.routerBack).not.toHaveBeenCalled()

    act(() => actions?.find((action) => action.text === 'Discard')?.onPress?.())
    expect(mocks.routerBack).toHaveBeenCalledOnce()
  })
})
