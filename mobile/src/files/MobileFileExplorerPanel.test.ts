import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileFileExplorerPanel } from './MobileFileExplorerPanel'
import type { MobileDirEntry } from './file-tree'
import type { RpcResponse } from '../transport/types'

type MockClient = {
  sendRequest: ReturnType<typeof vi.fn>
}

const mockTransport = vi.hoisted(() => ({
  client: null as MockClient | null,
  connectionState: 'connected',
  forceReconnect: vi.fn()
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: (props: {
      data: unknown[]
      keyExtractor: (item: unknown, index: number) => string
      renderItem: (info: {
        item: unknown
        index: number
        separators: Record<string, never>
      }) => unknown
    }) =>
      React.createElement(
        'FlatList',
        props,
        props.data.map((item, index) =>
          React.createElement(
            'FlatListItem',
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index, separators: {} })
          )
        )
      ),
    Pressable: 'Pressable',
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1
    },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView'
}))

vi.mock('expo-router', () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn()
  })
}))

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  File: 'File',
  FileText: 'FileText',
  Folder: 'Folder',
  Image: 'Image',
  X: 'X'
}))

vi.mock('../platform/haptics', () => ({
  triggerSelection: vi.fn()
}))

vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => mockTransport.forceReconnect,
  useHostClient: () => ({
    client: mockTransport.client,
    state: mockTransport.connectionState
  })
}))

function entry(name: string, isDirectory = false): MobileDirEntry {
  return { name, isDirectory }
}

function ok(result: MobileDirEntry[]): RpcResponse {
  return { id: 'response-id', ok: true, result, _meta: { runtimeId: 'runtime-id' } }
}

function createMockClient(entriesByPath: Record<string, MobileDirEntry[]>): MockClient {
  return {
    sendRequest: vi.fn(async (_method: string, params: { relativePath: string }) => {
      return ok(entriesByPath[params.relativePath] ?? [])
    })
  }
}

async function renderExplorer(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(MobileFileExplorerPanel, {
        hostId: 'host-a',
        worktreeId: 'worktree-a',
        name: 'Example Worktree',
        embedded: true
      })
    )
  })
  if (!renderer) {
    throw new Error('MobileFileExplorerPanel did not render')
  }
  return renderer
}

async function updateExplorer(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.update(
      createElement(MobileFileExplorerPanel, {
        hostId: 'host-a',
        worktreeId: 'worktree-a',
        name: 'Example Worktree',
        embedded: true
      })
    )
  })
}

async function pressByLabel(
  renderer: ReactTestRenderer,
  accessibilityLabel: string
): Promise<void> {
  const pressable = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === accessibilityLabel)
  if (!pressable) {
    throw new Error(`Unable to find pressable: ${accessibilityLabel}`)
  }
  await act(async () => {
    pressable.props.onPress()
  })
}

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.props.children)
    .join(' ')
}

describe('MobileFileExplorerPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockTransport.client = null
    mockTransport.connectionState = 'connected'
    mockTransport.forceReconnect = vi.fn()
  })

  it('loads directories lazily and reuses cached children when reopened', async () => {
    const client = createMockClient({
      '': [entry('src', true), entry('README.md')],
      src: [entry('app.ts'), entry('components', true)]
    })
    mockTransport.client = client

    const renderer = await renderExplorer()

    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(client.sendRequest).toHaveBeenLastCalledWith('files.readDir', {
      worktree: 'id:worktree-a',
      relativePath: ''
    })

    await pressByLabel(renderer, 'Open folder src')
    await vi.waitFor(() => expect(client.sendRequest).toHaveBeenCalledTimes(2))
    expect(client.sendRequest).toHaveBeenLastCalledWith('files.readDir', {
      worktree: 'id:worktree-a',
      relativePath: 'src'
    })
    expect(renderedText(renderer)).toContain('app.ts')

    await pressByLabel(renderer, 'Open folder src')
    await pressByLabel(renderer, 'Open folder src')

    expect(client.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded tree visible during a transient disconnect', async () => {
    const client = createMockClient({
      '': [entry('src', true), entry('README.md')]
    })
    mockTransport.client = client

    const renderer = await renderExplorer()
    expect(renderedText(renderer)).toContain('src')

    mockTransport.client = null
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)

    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(renderedText(renderer)).toContain('src')
    expect(renderedText(renderer)).toContain('README.md')
    expect(renderedText(renderer)).not.toContain('Waiting for desktop...')
  })

  it('refreshes the root in the background after reconnect without blanking the tree', async () => {
    const client = createMockClient({
      '': [entry('src', true), entry('README.md')]
    })
    mockTransport.client = client

    const renderer = await renderExplorer()
    expect(renderedText(renderer)).toContain('README.md')

    mockTransport.client = null
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)

    let resolveReload: ((response: RpcResponse) => void) | undefined
    const reconnectedClient: MockClient = {
      sendRequest: vi.fn(
        () =>
          new Promise<RpcResponse>((resolve) => {
            resolveReload = resolve
          })
      )
    }
    mockTransport.client = reconnectedClient
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)

    expect(reconnectedClient.sendRequest).toHaveBeenCalledTimes(1)
    expect(renderedText(renderer)).toContain('src')
    expect(renderedText(renderer)).toContain('README.md')

    await act(async () => {
      resolveReload?.(ok([entry('src', true), entry('README.md'), entry('CHANGELOG.md')]))
    })
    expect(renderedText(renderer)).toContain('CHANGELOG.md')
  })

  it('keeps the cached tree when a post-reconnect root refresh fails', async () => {
    const client = createMockClient({
      '': [entry('src', true), entry('README.md')]
    })
    mockTransport.client = client

    const renderer = await renderExplorer()
    expect(renderedText(renderer)).toContain('README.md')

    mockTransport.client = null
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)

    const failingClient: MockClient = {
      sendRequest: vi.fn(async () => {
        throw new Error('refresh failed')
      })
    }
    mockTransport.client = failingClient
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)

    expect(failingClient.sendRequest).toHaveBeenCalledTimes(1)
    expect(renderedText(renderer)).toContain('src')
    expect(renderedText(renderer)).toContain('README.md')
    expect(renderedText(renderer)).not.toContain('refresh failed')
  })

  it('refreshes expanded directories after reconnect and leaves collapsed directories lazy', async () => {
    mockTransport.client = createMockClient({
      '': [entry('src', true), entry('docs', true), entry('unopened', true)],
      src: [entry('old.ts')],
      docs: [entry('old.md')]
    })
    const renderer = await renderExplorer()
    await pressByLabel(renderer, 'Open folder src')
    await pressByLabel(renderer, 'Open folder docs')
    await pressByLabel(renderer, 'Open folder docs')
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)

    const reconnectedClient = createMockClient({
      '': [entry('src', true), entry('docs', true), entry('unopened', true)],
      src: [entry('new.ts')],
      docs: [entry('new.md')]
    })
    mockTransport.client = reconnectedClient
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)

    expect(renderedText(renderer)).toContain('new.ts')
    expect(renderedText(renderer)).not.toContain('old.ts')
    expect(reconnectedClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([
      '',
      'src'
    ])
    await pressByLabel(renderer, 'Open folder docs')
    expect(renderedText(renderer)).toContain('new.md')
    expect(reconnectedClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([
      '',
      'src',
      'docs'
    ])
    act(() => renderer.unmount())
  })

  it.each(['offline', 'after refresh'] as const)(
    'rejects an old directory response arriving %s',
    async (completion) => {
      let resolveOld!: (response: RpcResponse) => void
      const oldDirectory = new Promise<RpcResponse>((resolve) => {
        resolveOld = resolve
      })
      mockTransport.client = {
        sendRequest: vi.fn(async (_method, params) =>
          params.relativePath === '' ? ok([entry('src', true)]) : oldDirectory
        )
      }
      const renderer = await renderExplorer()
      await pressByLabel(renderer, 'Open folder src')
      mockTransport.connectionState = 'disconnected'
      await updateExplorer(renderer)
      if (completion === 'offline') {
        await act(async () => resolveOld(ok([entry('stale.ts')])))
        expect(renderedText(renderer)).not.toContain('stale.ts')
      }
      const freshClient = createMockClient({
        '': [entry('src', true)],
        src: [entry('fresh.ts')]
      })
      mockTransport.client = freshClient
      mockTransport.connectionState = 'connected'
      await updateExplorer(renderer)
      if (completion === 'after refresh') {
        await act(async () => resolveOld(ok([entry('stale.ts')])))
      }
      expect(renderedText(renderer)).toContain('fresh.ts')
      expect(renderedText(renderer)).not.toContain('stale.ts')
      expect(freshClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([
        '',
        'src'
      ])
      act(() => renderer.unmount())
    }
  )

  it('lets a failed directory refresh retry without continuously reloading it', async () => {
    mockTransport.client = createMockClient({ '': [entry('src', true)], src: [entry('old.ts')] })
    const renderer = await renderExplorer()
    await pressByLabel(renderer, 'Open folder src')
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)
    let fail = true
    const sendRequest = vi.fn(async (_method: string, params: { relativePath: string }) => {
      if (params.relativePath === '') {
        return ok([entry('src', true)])
      }
      if (fail) {
        throw new Error('SSH directory unavailable')
      }
      return ok([entry('fresh.ts')])
    })
    mockTransport.client = { sendRequest }
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)
    expect(renderedText(renderer)).toContain('SSH directory unavailable')
    expect(sendRequest).toHaveBeenCalledTimes(2)
    fail = false
    await pressByLabel(renderer, 'Retry loading src')
    expect(renderedText(renderer)).toContain('fresh.ts')
    expect(sendRequest).toHaveBeenCalledTimes(3)
    act(() => renderer.unmount())
  })

  it('does not request expanded directories again after a legacy root refresh fills the cache', async () => {
    mockTransport.client = createMockClient({ '': [entry('src', true)], src: [entry('old.ts')] })
    const renderer = await renderExplorer()
    await pressByLabel(renderer, 'Open folder src')
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)
    const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> =>
      method === 'files.readDir'
        ? {
            id: 'unavailable',
            ok: false,
            error: { code: 'method_not_found', message: 'Unknown method' },
            _meta: { runtimeId: 'runtime' }
          }
        : {
            id: 'list',
            ok: true,
            result: { files: [{ relativePath: 'src/fresh.ts' }], truncated: false },
            _meta: { runtimeId: 'runtime' }
          }
    )
    mockTransport.client = { sendRequest }
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)
    expect(renderedText(renderer)).toContain('fresh.ts')
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'files.readDir',
      'files.list'
    ])
    act(() => renderer.unmount())
  })

  it('keeps offline directory Retry usable and coalesces it with reconnect refresh', async () => {
    const offlineClient: MockClient = {
      sendRequest: vi.fn(async (_method, params) => {
        if (params.relativePath === '') {
          return ok([entry('src', true)])
        }
        throw new Error('Directory unavailable')
      })
    }
    mockTransport.client = offlineClient
    const renderer = await renderExplorer()
    await pressByLabel(renderer, 'Open folder src')
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)
    await pressByLabel(renderer, 'Retry loading src')
    expect(mockTransport.forceReconnect).toHaveBeenCalledExactlyOnceWith('host-a')
    expect(offlineClient.sendRequest).toHaveBeenCalledTimes(2)

    const freshClient = createMockClient({ '': [entry('src', true)], src: [entry('fresh.ts')] })
    mockTransport.client = freshClient
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)
    expect(renderedText(renderer)).toContain('fresh.ts')
    expect(freshClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([
      '',
      'src'
    ])
    act(() => renderer.unmount())
  })

  it('does not pre-read expanded descendants hidden under a collapsed directory', async () => {
    const entries = {
      '': [entry('src', true)],
      src: [entry('deep', true)],
      'src/deep': [entry('old.ts')]
    }
    mockTransport.client = createMockClient(entries)
    const renderer = await renderExplorer()
    await pressByLabel(renderer, 'Open folder src')
    await pressByLabel(renderer, 'Open folder deep')
    await pressByLabel(renderer, 'Open folder src')
    mockTransport.connectionState = 'disconnected'
    await updateExplorer(renderer)

    const freshClient = createMockClient({ ...entries, 'src/deep': [entry('fresh.ts')] })
    mockTransport.client = freshClient
    mockTransport.connectionState = 'connected'
    await updateExplorer(renderer)
    expect(freshClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([''])
    await pressByLabel(renderer, 'Open folder src')
    expect(renderedText(renderer)).toContain('fresh.ts')
    expect(freshClient.sendRequest.mock.calls.map((call) => call[1].relativePath)).toEqual([
      '',
      'src',
      'src/deep'
    ])
    act(() => renderer.unmount())
  })

  it.each([false, true])(
    'defers expanding an uncached folder until the pending root refresh completes (legacy: %s)',
    async (legacy) => {
      mockTransport.client = createMockClient({ '': [entry('src', true)] })
      const renderer = await renderExplorer()
      mockTransport.connectionState = 'disconnected'
      await updateExplorer(renderer)
      let resolveRoot!: (response: RpcResponse) => void
      const root = new Promise<RpcResponse>((resolve) => {
        resolveRoot = resolve
      })
      let resolveChild!: (response: RpcResponse) => void
      const child = new Promise<RpcResponse>((resolve) => {
        resolveChild = resolve
      })
      const unavailable: RpcResponse = {
        id: 'unavailable',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method' },
        _meta: { runtimeId: 'runtime' }
      }
      const sendRequest = vi.fn(async (method: string, params: { relativePath?: string }) => {
        if (method === 'files.list') {
          return {
            id: 'list',
            ok: true,
            result: { files: [{ relativePath: 'src/fresh.ts' }], truncated: false },
            _meta: { runtimeId: 'runtime' }
          }
        }
        if (params.relativePath === '') {
          return root
        }
        return legacy ? child : ok([entry('fresh.ts')])
      })
      mockTransport.client = { sendRequest }
      mockTransport.connectionState = 'connected'
      await updateExplorer(renderer)
      await pressByLabel(renderer, 'Open folder src')
      expect(sendRequest).toHaveBeenCalledTimes(1)

      await act(async () => resolveRoot(legacy ? unavailable : ok([entry('src', true)])))
      await act(async () => resolveChild(unavailable))
      expect(renderedText(renderer)).toContain('fresh.ts')
      expect(renderedText(renderer)).not.toContain('Unknown method')
      expect(
        sendRequest.mock.calls.map(([method, params]) => [method, params.relativePath])
      ).toEqual(
        legacy
          ? [
              ['files.readDir', ''],
              ['files.list', undefined]
            ]
          : [
              ['files.readDir', ''],
              ['files.readDir', 'src']
            ]
      )
      act(() => renderer.unmount())
    }
  )

  it('falls back to the capped files.list against desktops without files.readDir', async () => {
    const legacyClient: MockClient = {
      sendRequest: vi.fn(async (method: string): Promise<RpcResponse> => {
        if (method === 'files.readDir') {
          return {
            id: 'response-id',
            ok: false,
            error: {
              code: 'forbidden',
              message: "Method 'files.readDir' is not available to mobile clients"
            },
            _meta: { runtimeId: 'runtime-id' }
          }
        }
        return {
          id: 'response-id',
          ok: true,
          result: {
            files: [
              { relativePath: 'src/app.ts', basename: 'app.ts', kind: 'text' },
              { relativePath: 'README.md', basename: 'README.md', kind: 'text' }
            ],
            totalCount: 2,
            truncated: false
          },
          _meta: { runtimeId: 'runtime-id' }
        }
      })
    }
    mockTransport.client = legacyClient

    const renderer = await renderExplorer()

    expect(legacyClient.sendRequest).toHaveBeenCalledWith('files.list', {
      worktree: 'id:worktree-a'
    })
    expect(renderedText(renderer)).toContain('src')
    expect(renderedText(renderer)).toContain('README.md')

    await pressByLabel(renderer, 'Open folder src')
    expect(renderedText(renderer)).toContain('app.ts')
    // Every directory comes from the synthesized cache: one readDir attempt
    // plus one files.list call total, no per-directory RPCs afterwards.
    expect(legacyClient.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('surfaces the legacy cap note when the files.list fallback is truncated', async () => {
    const legacyClient: MockClient = {
      sendRequest: vi.fn(async (method: string): Promise<RpcResponse> => {
        if (method === 'files.readDir') {
          return {
            id: 'response-id',
            ok: false,
            error: { code: 'method_not_found', message: 'Unknown method' },
            _meta: { runtimeId: 'runtime-id' }
          }
        }
        return {
          id: 'response-id',
          ok: true,
          result: {
            files: [{ relativePath: 'README.md', basename: 'README.md', kind: 'text' }],
            totalCount: 6000,
            truncated: true
          },
          _meta: { runtimeId: 'runtime-id' }
        }
      })
    }
    mockTransport.client = legacyClient

    const renderer = await renderExplorer()

    expect(renderedText(renderer)).toContain('README.md')
    expect(renderedText(renderer)).toContain('Showing first 5000')
  })

  it('reports the files.list failure when the fallback itself fails', async () => {
    const legacyClient: MockClient = {
      sendRequest: vi.fn(async (method: string): Promise<RpcResponse> => {
        if (method === 'files.readDir') {
          return {
            id: 'response-id',
            ok: false,
            error: {
              code: 'forbidden',
              message: "Method 'files.readDir' is not available to mobile clients"
            },
            _meta: { runtimeId: 'runtime-id' }
          }
        }
        return {
          id: 'response-id',
          ok: false,
          error: { code: 'internal', message: 'legacy list failed' },
          _meta: { runtimeId: 'runtime-id' }
        }
      })
    }
    mockTransport.client = legacyClient

    const renderer = await renderExplorer()

    expect(renderedText(renderer)).toContain('legacy list failed')
    expect(renderedText(renderer)).not.toContain('not available to mobile clients')
  })
})
