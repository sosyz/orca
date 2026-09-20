import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatFileSearch } from './use-mobile-native-chat-file-search'

type Response = Awaited<ReturnType<RpcClient['sendRequest']>>
type SearchState = ReturnType<typeof useMobileNativeChatFileSearch>
const success = (path: string): Response => ({
  id: 'files',
  ok: true,
  result: { files: [{ relativePath: path }] },
  _meta: { runtimeId: 'runtime' }
})
const unsupported: Response = {
  id: 'files',
  ok: false,
  error: { code: 'method_not_found', message: 'Unknown method' },
  _meta: { runtimeId: 'runtime' }
}
function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('native chat file search lifecycle', () => {
  let renderer: ReactTestRenderer | null = null
  let state: SearchState
  function Query({ search, text }: { search: (query: string) => void; text: string }): null {
    useEffect(() => search(text), [search, text])
    return null
  }
  function Harness({
    client,
    worktreeId = 'workspace',
    query
  }: {
    client: RpcClient
    worktreeId?: string
    query?: string
  }) {
    state = useMobileNativeChatFileSearch({ client, worktreeId })
    return query === undefined
      ? null
      : createElement(Query, { search: state.loadNativeChatFiles, text: query })
  }
  async function mount(sendRequest: ReturnType<typeof vi.fn>): Promise<void> {
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { client }))
      } else {
        renderer = create(createElement(Harness, { client }))
      }
    })
  }
  async function query(text: string): Promise<void> {
    act(() => state.loadNativeChatFiles(text))
    await act(async () => vi.advanceTimersByTimeAsync(120))
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('evicts a bare @ query when it is the oldest of more than 20 cached queries', async () => {
    const sendRequest = vi.fn(async () => success('src/app.ts'))
    await mount(sendRequest)
    await query('')
    for (let index = 0; index < 20; index++) {
      await query(`query-${index}`)
    }
    expect(sendRequest).toHaveBeenCalledTimes(21)
    await query('')
    expect(sendRequest).toHaveBeenCalledTimes(22)
  })

  it('does not let an old host rejection disable search or launch its legacy read', async () => {
    const old = deferred()
    const previousRequest = vi.fn(() => old.promise)
    await mount(previousRequest)
    await query('previous')
    const currentRequest = vi.fn(async () => success('src/current.ts'))
    await mount(currentRequest)
    await query('current')
    await act(async () => old.resolve(unsupported))
    await query('next')
    expect(previousRequest.mock.calls).toHaveLength(1)
    expect(currentRequest.mock.calls.map(([method]) => method)).toEqual([
      'files.searchPaths',
      'files.searchPaths'
    ])
    expect(state.nativeChatFilePaths).toEqual(['src/current.ts'])
  })

  it('does not let an old host success invalidate the current legacy capability', async () => {
    const old = deferred()
    await mount(vi.fn(() => old.promise))
    await query('previous')
    const currentRequest = vi.fn(async (method: string) =>
      method === 'files.searchPaths' ? unsupported : success('src/current.ts')
    )
    await mount(currentRequest)
    await query('current')
    await act(async () => old.resolve(success('src/previous.ts')))
    await query('src')
    expect(currentRequest.mock.calls.map(([method]) => method)).toEqual([
      'files.searchPaths',
      'files.list'
    ])
    expect(state.nativeChatFilePaths).toEqual(['src/current.ts'])
  })

  it('does not begin a full legacy inventory after the composer has unmounted', async () => {
    const pending = deferred()
    const sendRequest = vi.fn(() => pending.promise)
    await mount(sendRequest)
    await query('readme')
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => pending.resolve(unsupported))
    expect(sendRequest.mock.calls).toHaveLength(1)
  })

  it('loads a restored @ draft when the child composer queries on first mount', async () => {
    const sendRequest = vi.fn(async () => success('readme.md'))
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Harness, { client, query: 'readme' }))
    })
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state.nativeChatFilePaths).toEqual(['readme.md'])
  })

  it('searches the new worktree when the composer retains the same @ draft', async () => {
    const sendRequest = vi.fn(async (_method: string, params: { worktree: string }) =>
      success(`${params.worktree}/readme.md`)
    )
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Harness, { client, worktreeId: 'A' }))
    })
    await query('readme')
    expect(state.nativeChatFilePaths).toEqual(['id:A/readme.md'])
    await act(async () => {
      renderer!.update(createElement(Harness, { client, worktreeId: 'B', query: 'readme' }))
    })
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state.nativeChatFilePaths).toEqual(['id:B/readme.md'])
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
})
