import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileFileExplorerPanel } from './MobileFileExplorerPanel'
import type { RpcResponse } from '../transport/types'

const mocks = vi.hoisted(() => ({
  client: { sendRequest: vi.fn() },
  connectionState: 'connected',
  router: { push: vi.fn(), back: vi.fn() }
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: (props: { data: unknown[]; renderItem: (info: { item: unknown }) => unknown }) =>
      React.createElement(
        'FlatList',
        props,
        props.data.map((item, index) =>
          React.createElement('Row', { key: index }, props.renderItem({ item }))
        )
      ),
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
  }
})
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('expo-router', () => ({ useRouter: () => mocks.router }))
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
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn() }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: mocks.client, state: mocks.connectionState }),
  useForceReconnect: () => vi.fn()
}))

const ok = (result: unknown): RpcResponse => ({ id: 'id', ok: true, result })
const link = (name: string) => ({ name, isDirectory: false, isSymlink: true })
const directory = (name: string) => ({ name, isDirectory: true })
const stat = (isDirectory: boolean) => ok({ size: 12, mtime: 1, isDirectory })
function deferred() {
  let resolve!: (value: RpcResponse) => void
  const promise = new Promise<RpcResponse>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let renderer: ReactTestRenderer | undefined
async function render() {
  await act(async () => {
    renderer = create(
      createElement(MobileFileExplorerPanel, {
        hostId: 'host-a',
        worktreeId: 'folder-a',
        embedded: true
      })
    )
  })
}
async function update() {
  await act(async () => {
    renderer!.update(
      createElement(MobileFileExplorerPanel, {
        hostId: 'host-a',
        worktreeId: 'folder-a',
        embedded: true
      })
    )
  })
}
function button(name: string) {
  const row = renderer!.root
    .findAllByType('Pressable')
    .find(
      (item) =>
        typeof item.props.accessibilityLabel === 'string' &&
        item.props.accessibilityLabel.endsWith(` ${name}`)
    )
  if (!row) {
    throw new Error(`Missing row ${name}`)
  }
  return row
}
async function press(name: string) {
  await act(async () => {
    button(name).props.onPress()
  })
}
const text = () => JSON.stringify(renderer!.toJSON())
afterEach(async () => {
  if (renderer) {
    await act(async () => renderer!.unmount())
  }
  renderer = undefined
  mocks.client = { sendRequest: vi.fn() }
  mocks.connectionState = 'connected'
  vi.clearAllMocks()
})

describe('explicit mobile symlink activation', () => {
  it('never automatically traverses a directory link back to an ancestor', async () => {
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat' ? stat(true) : ok([link('loop')])
    )
    await render()
    await press('loop')
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(3)
    const nested = renderer!.root
      .findAllByType('Pressable')
      .find((row) => row.props.accessibilityLabel === 'Open link loop')
    expect(nested).toBeDefined()
    expect(text()).not.toContain('loop/loop/loop')
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it('keeps unsupported file symlinks unavailable after probing without opening a preview', async () => {
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat' ? stat(false) : ok([link('archive.zip')])
    )
    await render()
    await press('archive.zip')
    expect(text()).toContain('This file type is unavailable on mobile.')
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('allows a failed stat to be retried by clicking the same link', async () => {
    mocks.client.sendRequest
      .mockResolvedValueOnce(ok([link('docs')]))
      .mockRejectedValueOnce(new Error('Disconnected'))
      .mockResolvedValueOnce(stat(true))
      .mockResolvedValueOnce(ok([{ name: 'readme.md', isDirectory: false }]))
    await render()
    await press('docs')
    expect(text()).toContain('Disconnected')
    await press('docs')
    expect(text()).toContain('readme.md')
    expect(text()).not.toContain('Disconnected')
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(4)
  })

  it('does not let an old cancelled stat clear a newer activation of the same link', async () => {
    const old = deferred()
    const fresh = deferred()
    const reads = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    mocks.client.sendRequest.mockImplementation(async (method, params) =>
      method === 'files.stat'
        ? reads()
        : ok(
            params.relativePath === ''
              ? [directory('docs')]
              : params.relativePath === 'docs'
                ? [link('linked')]
                : []
          )
    )
    await render()
    await press('docs')
    await press('linked')
    await press('docs')
    await press('docs')
    await press('linked')
    await act(async () => old.resolve(stat(false)))
    expect(text()).toContain('Loading...')
    expect(mocks.router.push).not.toHaveBeenCalled()
    await act(async () => fresh.resolve(stat(true)))
    expect(button('linked').props.accessibilityLabel).toBe('Open folder linked')
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(5)
  })

  it.each(['linked-docs', 'archive.zip'])(
    'resolves %s only on click and expands its directory target',
    async (name) => {
      mocks.client.sendRequest.mockImplementation(async (method, params) => {
        if (method === 'files.stat') {
          return stat(true)
        }
        return ok(
          params.relativePath === ''
            ? [link(name), link('untouched')]
            : [{ name: 'README.md', isDirectory: false }]
        )
      })
      await render()
      expect(mocks.client.sendRequest).toHaveBeenCalledTimes(1)
      expect(button(name).props.disabled).toBe(false)
      await press(name)
      expect(mocks.client.sendRequest).toHaveBeenNthCalledWith(2, 'files.stat', {
        worktree: 'id:folder-a',
        relativePath: name
      })
      expect(mocks.client.sendRequest).toHaveBeenNthCalledWith(3, 'files.readDir', {
        worktree: 'id:folder-a',
        relativePath: name
      })
      expect(mocks.client.sendRequest).toHaveBeenCalledTimes(3)
      expect(text()).toContain('README.md')
      expect(mocks.router.push).not.toHaveBeenCalled()
      await press(name)
      await press(name)
      expect(mocks.client.sendRequest).toHaveBeenCalledTimes(3)
    }
  )

  it.each(['readme.md', 'logo.png'])('preserves the %s file preview route', async (name) => {
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat' ? stat(false) : ok([link(name)])
    )
    await render()
    await press(name)
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(2)
    expect(mocks.router.push).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ relativePath: name }) })
    )
  })

  it.each([
    ['ENOENT', 'Link target does not exist'],
    ['ELOOP', 'Too many symbolic links'],
    ['path_access_denied', 'Access denied'],
    ['method_not_found', 'Update Orca'],
    ['forbidden', 'Update Orca']
  ])('shows %s without guessing a directory or routing to a file', async (code, message) => {
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat'
        ? {
            id: 'id',
            ok: false,
            error: {
              code,
              message: code === 'method_not_found' || code === 'forbidden' ? 'unsupported' : message
            }
          }
        : ok([link('broken')])
    )
    await render()
    await press('broken')
    expect(text()).toContain(message)
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('deduplicates pending clicks and ignores an activation after its ancestor closes and reopens', async () => {
    const pending = deferred()
    mocks.client.sendRequest.mockImplementation(async (method, params) =>
      method === 'files.stat'
        ? pending.promise
        : ok(params.relativePath === '' ? [directory('docs')] : [link('linked')])
    )
    await render()
    await press('docs')
    await press('linked')
    await press('linked')
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(3)
    await press('docs')
    await press('docs')
    await act(async () => pending.resolve(stat(true)))
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(3)
    expect(button('linked').props.accessibilityLabel).not.toBe('Open folder linked')
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it('ignores an old stat after reconnect replaces the same path with a file', async () => {
    const pending = deferred()
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat' ? pending.promise : ok([link('linked')])
    )
    await render()
    await press('linked')
    mocks.connectionState = 'disconnected'
    await update()
    mocks.connectionState = 'connected'
    mocks.client = { sendRequest: vi.fn(async () => ok([{ name: 'linked', isDirectory: false }])) }
    await update()
    await act(async () => pending.resolve(stat(true)))
    expect(button('linked').props.accessibilityLabel).toBe('Preview file linked')
    expect(mocks.client.sendRequest).toHaveBeenCalledTimes(1)
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it('does not navigate when a file stat returns after unmount', async () => {
    const pending = deferred()
    mocks.client.sendRequest.mockImplementation(async (method) =>
      method === 'files.stat' ? pending.promise : ok([link('readme.md')])
    )
    await render()
    await press('readme.md')
    await act(async () => renderer!.unmount())
    renderer = undefined
    await act(async () => pending.resolve(stat(false)))
    expect(mocks.router.push).not.toHaveBeenCalled()
  })
})
