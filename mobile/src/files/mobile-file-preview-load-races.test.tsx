import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { MobileFilePreviewScreen } from './MobileFilePreviewScreen'
import type { MobileFilePreviewResult } from './mobile-file-preview-request'
import type { MobileFilePreviewRouteState } from './mobile-file-preview-route'

type BodyProps = {
  preview: MobileFilePreviewResult
  draftContent: string
  saveError: string
  onDraftChange: (content: string) => void
}

const mocks = vi.hoisted(() => ({
  body: null as BodyProps | null,
  sendRequest: vi.fn(),
  client: {} as { sendRequest: ReturnType<typeof vi.fn> },
  router: { back: vi.fn() }
}))

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Pressable: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('Pressable', props, children),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', Save: 'Save' }))
vi.mock('expo-router', () => ({ useRouter: () => mocks.router }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isLandscape: false })
}))
vi.mock('../navigation/use-mobile-route-back-handler', () => ({
  useMobileRouteBackHandler: vi.fn()
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => vi.fn(),
  useHostClient: () => ({ client: mocks.client, state: 'connected' })
}))
vi.mock('./MobileFilePreviewBody', () => ({
  MobileFilePreviewBody: (props: BodyProps) => {
    mocks.body = props
    return null
  }
}))

function success(result: unknown): RpcResponse {
  return { id: 'read', ok: true, result, _meta: { runtimeId: 'runtime' } }
}

function fileContent(content: string): RpcResponse {
  return success({ content, truncated: false, byteLength: content.length })
}

const route: MobileFilePreviewRouteState = {
  ok: true,
  params: {
    source: 'terminalArtifact',
    hostId: 'host',
    worktreeId: 'workspace',
    absolutePath: '/tmp/result.txt',
    grantId: 'expired-grant'
  }
}

describe('terminal artifact preview load ownership', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.body = null
    mocks.sendRequest.mockReset()
    mocks.client = { sendRequest: mocks.sendRequest }
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function save(): Promise<void> {
    const button = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save terminal artifact')
    expect(button?.props.disabled).toBe(false)
    await act(async () => button!.props.onPress())
  }

  it('keeps one save in flight when Save is tapped twice before rendering', async () => {
    let resolveRead!: (response: RpcResponse) => void
    const pendingRead = new Promise<RpcResponse>((resolve) => {
      resolveRead = resolve
    })
    let reads = 0
    mocks.sendRequest.mockImplementation(async (method: string) => {
      if (method === 'files.writeTerminalArtifact') {
        return success({})
      }
      return ++reads === 1 ? fileContent('initial') : pendingRead
    })
    await act(async () => {
      renderer = create(createElement(MobileFilePreviewScreen, { route }))
    })
    act(() => mocks.body!.onDraftChange('saved edit'))
    const button = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save terminal artifact')!
    act(() => {
      button.props.onPress()
      button.props.onPress()
    })
    expect(reads).toBe(2)
    act(() => mocks.body!.onDraftChange('newer unsaved edit'))
    await act(async () => {
      resolveRead(fileContent('initial'))
    })
    expect(
      mocks.sendRequest.mock.calls.filter(([method]) => method === 'files.writeTerminalArtifact')
    ).toEqual([['files.writeTerminalArtifact', expect.objectContaining({ content: 'saved edit' })]])
    expect(mocks.body?.draftContent).toBe('newer unsaved edit')
  })

  it.each(['succeeds', 'rejects'] as const)(
    'keeps newer edits and their save baseline when the pre-refresh read %s late',
    async (oldOutcome) => {
      let resolveOld!: (response: RpcResponse) => void
      let rejectOld!: (error: Error) => void
      const oldRead = new Promise<RpcResponse>((resolve, reject) => {
        resolveOld = resolve
        rejectOld = reject
      })
      let readCount = 0
      let hostContent = 'fresh content'
      mocks.sendRequest.mockImplementation(async (method: string, params: { content?: string }) => {
        if (method === 'files.resolveTerminalPath') {
          return success({
            exists: true,
            isDirectory: false,
            openTarget: {
              kind: 'absolute-file',
              absolutePath: '/tmp/result.txt',
              grantId: 'fresh-grant'
            }
          })
        }
        if (method === 'files.writeTerminalArtifact') {
          hostContent = params.content!
          return success({})
        }
        readCount += 1
        if (readCount === 1) {
          return {
            id: 'expired',
            ok: false,
            error: { code: 'terminal_file_grant_expired', message: 'Grant expired' },
            _meta: { runtimeId: 'runtime' }
          }
        }
        return readCount === 2 ? oldRead : fileContent(hostContent)
      })
      await act(async () => {
        renderer = create(createElement(MobileFilePreviewScreen, { route }))
      })
      expect(mocks.sendRequest.mock.calls.map(([method]) => method)).toEqual([
        'files.readTerminalArtifact',
        'files.resolveTerminalPath',
        'files.readTerminalArtifact',
        'files.readTerminalArtifact'
      ])
      expect(mocks.body?.draftContent).toBe('fresh content')
      act(() => mocks.body!.onDraftChange('unsaved edit'))

      await act(async () => {
        if (oldOutcome === 'succeeds') {
          resolveOld(fileContent('older content'))
        } else {
          rejectOld(new Error('old read disconnected'))
        }
      })
      expect(mocks.body?.draftContent).toBe('unsaved edit')
      expect(mocks.body?.preview).toMatchObject({ status: 'ready', content: 'fresh content' })
      expect(mocks.body?.saveError).toBe('')

      await save()
      expect(hostContent).toBe('unsaved edit')
      expect(mocks.body?.saveError).toBe('')
      expect(mocks.sendRequest).toHaveBeenCalledWith('files.writeTerminalArtifact', {
        worktree: 'id:workspace',
        absolutePath: '/tmp/result.txt',
        grantId: 'fresh-grant',
        content: 'unsaved edit'
      })
      act(() => mocks.body!.onDraftChange('next edit'))
      await save()
      expect(hostContent).toBe('next edit')
      expect(mocks.body?.saveError).toBe('')
    }
  )
})
