import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { MobileGitHistoryList } from './MobileGitHistoryList'

const renders = vi.hoisted(() => ({ subjects: [] as string[][] }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: ({
    data,
    renderItem
  }: {
    data: { id: string; subject: string }[]
    renderItem: (info: { item: { id: string } }) => ReactElement
  }) => {
    renders.subjects.push(data.map((item) => item.subject))
    return createElement(
      'FlatList',
      null,
      data.map((item) => createElement('Row', { key: item.id }, renderItem({ item })))
    )
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('../transport/client-context', () => ({ useForceReconnect: () => vi.fn() }))

function historyResponse(subject: string, id = 'commit-1') {
  return {
    ok: true,
    result: {
      items: [{ id, displayId: id.slice(0, 7), subject, author: 'Ada', parentIds: [] }]
    }
  }
}

function compareResponse(path = 'src/app.ts', added = 3, removed = 1) {
  return {
    ok: true,
    result: { entries: [{ path, added, removed }] }
  }
}

const emptyCompareResponse = {
  ok: true,
  result: { entries: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MobileGitHistoryList', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    renders.subjects.length = 0
  })

  function listElement(
    client: RpcClient | null,
    connState: ConnectionState,
    overrides: { hostId?: string; worktreeId?: string } = {}
  ) {
    return createElement(MobileGitHistoryList, {
      client,
      connState,
      worktreeId: overrides.worktreeId ?? 'wt-1',
      hostId: overrides.hostId ?? 'host-1',
      bottomInset: 0
    })
  }

  async function render(client: RpcClient, connState: ConnectionState): Promise<void> {
    await act(async () => {
      renderer = create(listElement(client, connState))
      await Promise.resolve()
    })
  }

  async function update(client: RpcClient | null, connState: ConnectionState): Promise<void> {
    await act(async () => {
      renderer?.update(listElement(client, connState))
      await Promise.resolve()
    })
  }

  function tree(): string {
    return JSON.stringify(renderer?.toJSON())
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
  }

  function firstPressable() {
    return renderer?.root.findAll(
      (node) => node.type === 'Pressable' && node.props.onPress !== undefined
    )[0]
  }

  it('keeps loaded commits visible across a disconnect and its reconnect refetch', async () => {
    let releaseRefetch: (() => void) | null = null
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(historyResponse('first load'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefetch = () => resolve(historyResponse('after reconnect'))
          })
      )
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    expect(tree()).toContain('first load')

    await update(client, 'reconnecting')
    expect(tree()).toContain('first load')

    // The refetch is in flight: old rows must stay up instead of flashing empty.
    await update(client, 'connected')
    expect(tree()).toContain('first load')

    await act(async () => {
      releaseRefetch?.()
      await Promise.resolve()
    })
    expect(tree()).toContain('after reconnect')
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('wipes commits when the worktree identity changes', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(historyResponse('worktree one'))
      .mockReturnValueOnce(new Promise(() => {}))
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    expect(tree()).toContain('worktree one')

    await act(async () => {
      renderer?.update(
        createElement(MobileGitHistoryList, {
          client,
          connState: 'connected',
          worktreeId: 'wt-2',
          hostId: 'host-1',
          bottomInset: 0
        })
      )
    })
    expect(tree()).not.toContain('worktree one')
  })

  it('refetches the expanded commit files after a reconnect instead of caching the outage answer', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'git.history') {
        return Promise.resolve(historyResponse('expandable'))
      }
      return Promise.resolve(compareResponse())
    })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await update(client, 'disconnected')

    await act(async () => {
      firstPressable()?.props.onPress()
    })
    // Offline expand cannot request anything, so nothing is cached as "no file changes".
    expect(tree()).toContain('Waiting for desktop...')
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await update(client, 'connected')
    expect(sendRequest).toHaveBeenCalledWith('git.commitCompare', {
      worktree: 'id:wt-1',
      commitId: 'commit-1'
    })
    expect(tree()).toContain('src/app.ts')
  })

  it('shows a retryable error when commit compare returns non-ok', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(historyResponse('expandable'))
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'compare-failed', message: 'Could not compare commit' },
        _meta: { runtimeId: 'r' }
      })
      .mockResolvedValueOnce(compareResponse('src/retry.ts', 2, 0))
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('Could not compare commit')
    expect(tree()).toContain('Retry')
    expect(tree()).not.toContain('No file changes')

    const retry = renderer?.root.findByProps({ accessibilityLabel: 'Retry file changes' })
    await act(async () => {
      retry?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('src/retry.ts')
  })

  it('shows a retryable error when commit compare rejects', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'git.history') {
        return Promise.resolve(historyResponse('expandable'))
      }
      return Promise.reject(new Error('Compare request failed'))
    })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('Compare request failed')
    expect(tree()).toContain('Retry')
    expect(tree()).not.toContain('No file changes')
  })

  it('keeps loaded file changes visible when reconnect compare returns non-ok', async () => {
    const compareResponses = [
      compareResponse('src/original.ts', 3, 1),
      {
        ok: false,
        error: { code: 'compare-failed', message: 'Could not compare after reconnect' },
        _meta: { runtimeId: 'r' }
      },
      compareResponse('src/retry.ts', 1, 0)
    ]
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'git.history') {
        return Promise.resolve(historyResponse('expandable'))
      }
      return Promise.resolve(compareResponses.shift())
    })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })
    expect(tree()).toContain('src/original.ts')

    await update(client, 'disconnected')
    await update(client, 'connected')
    expect(tree()).toContain('Could not compare after reconnect')
    expect(tree()).toContain('src/original.ts')
    expect(tree()).not.toContain('No file changes')

    const retry = renderer?.root.findByProps({ accessibilityLabel: 'Retry file changes' })
    await act(async () => {
      retry?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('src/retry.ts')
    expect(tree()).not.toContain('src/original.ts')
  })

  it('keeps loaded file changes visible when reconnect compare rejects', async () => {
    let compareAttempt = 0
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'git.history') {
        return Promise.resolve(historyResponse('expandable'))
      }
      compareAttempt += 1
      if (compareAttempt === 1) {
        return Promise.resolve(compareResponse('src/original.ts', 3, 1))
      }
      if (compareAttempt === 2) {
        return Promise.reject(new Error('Reconnect compare failed'))
      }
      return Promise.resolve(compareResponse('src/retry.ts', 1, 0))
    })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })
    expect(tree()).toContain('src/original.ts')

    await update(client, 'disconnected')
    await update(client, 'connected')
    expect(tree()).toContain('Reconnect compare failed')
    expect(tree()).toContain('src/original.ts')
    expect(tree()).not.toContain('No file changes')

    const retry = renderer?.root.findByProps({ accessibilityLabel: 'Retry file changes' })
    await act(async () => {
      retry?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('src/retry.ts')
    expect(tree()).not.toContain('src/original.ts')
  })

  it('keeps the empty state for a successful compare with no file changes', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'git.history') {
        return Promise.resolve(historyResponse('empty diff'))
      }
      return Promise.resolve(emptyCompareResponse)
    })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('No file changes')
    expect(tree()).not.toContain('Failed to load file changes')
  })

  it('ignores a late commit compare result after host and worktree change', async () => {
    let resolveOldCompare: (() => void) | null = null
    const sendRequest = vi
      .fn()
      .mockImplementation((method: string, params: { worktree?: string }) => {
        if (method === 'git.history') {
          return Promise.resolve(
            params.worktree === 'id:wt-2'
              ? historyResponse('new worktree', 'new-commit')
              : historyResponse('old worktree', 'old-commit')
          )
        }
        if (params.worktree === 'id:wt-2') {
          return Promise.resolve(compareResponse('src/new.ts', 1, 0))
        }
        return new Promise((resolve) => {
          resolveOldCompare = () => resolve(compareResponse('src/old.ts', 9, 0))
        })
      })
    const client = { sendRequest } as unknown as RpcClient

    await render(client, 'connected')
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })
    await act(async () => {
      renderer?.update(listElement(client, 'connected', { hostId: 'host-2', worktreeId: 'wt-2' }))
      await flushPromises()
    })
    await act(async () => {
      resolveOldCompare?.()
      await flushPromises()
    })
    await act(async () => {
      firstPressable()?.props.onPress()
      await flushPromises()
    })

    expect(tree()).toContain('new worktree')
    expect(tree()).toContain('src/new.ts')
    expect(tree()).not.toContain('src/old.ts')
  })

  it('hides old rows and expanded files through null and a replacement client without probing its old commit', async () => {
    const oldClient = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'git.history'
          ? historyResponse('Old client commit', 'old-commit')
          : compareResponse('src/old-client.ts')
      )
    } as unknown as RpcClient
    await render(oldClient, 'connected')
    await act(async () => firstPressable()?.props.onPress())
    expect(tree()).toContain('src/old-client.ts')
    const oldToggle = firstPressable()!.props.onPress

    renders.subjects.length = 0
    await update(null, 'connecting')
    expect(tree()).not.toContain('Old client commit')
    expect(tree()).not.toContain('src/old-client.ts')
    expect(renders.subjects.flat()).not.toContain('Old client commit')

    const newHistory = deferred<ReturnType<typeof historyResponse>>()
    const newRequest = vi.fn((method: string) =>
      method === 'git.history'
        ? newHistory.promise
        : Promise.resolve(compareResponse('src/new-client.ts'))
    )
    const newClient = { sendRequest: newRequest } as unknown as RpcClient
    await update(newClient, 'connected')
    expect(tree()).not.toContain('Old client commit')
    expect(newRequest).toHaveBeenCalledTimes(1)
    expect(newRequest).toHaveBeenCalledWith('git.history', { worktree: 'id:wt-1', limit: 50 })

    await act(async () => {
      newHistory.resolve(historyResponse('New client commit', 'new-commit'))
      await newHistory.promise
    })
    await act(async () => oldToggle())
    expect(newRequest).toHaveBeenCalledTimes(1)
    await act(async () => firstPressable()?.props.onPress())
    expect(newRequest).toHaveBeenLastCalledWith('git.commitCompare', {
      worktree: 'id:wt-1',
      commitId: 'new-commit'
    })
    expect(tree()).toContain('src/new-client.ts')
  })

  it('does not retain old expanded files or adopt old replies on an A-to-B-to-A visit', async () => {
    const oldCompare = deferred<ReturnType<typeof compareResponse>>()
    const returningHistory = deferred<ReturnType<typeof historyResponse>>()
    let historyReads = 0
    let compareReads = 0
    const aRequest = vi.fn((method: string) => {
      if (method === 'git.history') {
        historyReads += 1
        return historyReads === 1
          ? Promise.resolve(historyResponse('First A visit', 'shared-commit'))
          : returningHistory.promise
      }
      compareReads += 1
      return compareReads === 1
        ? oldCompare.promise
        : Promise.resolve(compareResponse('src/new-a.ts'))
    })
    const clientA = { sendRequest: aRequest } as unknown as RpcClient
    await render(clientA, 'connected')
    await act(async () => firstPressable()?.props.onPress())
    const abandonedHistory = deferred<ReturnType<typeof historyResponse>>()
    const bRequest = vi.fn(() => abandonedHistory.promise)
    await update({ sendRequest: bRequest } as unknown as RpcClient, 'connected')
    await update(clientA, 'connected')

    expect(tree()).not.toContain('First A visit')
    expect(compareReads).toBe(1)
    expect(bRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      oldCompare.resolve(compareResponse('src/late-old-a.ts'))
      abandonedHistory.resolve(historyResponse('Abandoned B visit'))
      await flushPromises()
    })
    expect(tree()).not.toContain('src/late-old-a.ts')
    expect(tree()).not.toContain('Abandoned B visit')

    await act(async () => {
      returningHistory.resolve(historyResponse('Current A visit', 'shared-commit'))
      await returningHistory.promise
    })
    expect(tree()).not.toContain('src/late-old-a.ts')
    await act(async () => firstPressable()?.props.onPress())
    expect(tree()).toContain('src/new-a.ts')
  })

  it('does not keep a previous client read error while its replacement loads', async () => {
    const oldClient = {
      sendRequest: vi.fn(async () => {
        throw new Error('Old host unavailable')
      })
    } as unknown as RpcClient
    await render(oldClient, 'connected')
    expect(tree()).toContain('Old host unavailable')
    const pending = deferred<ReturnType<typeof historyResponse>>()
    const newClient = { sendRequest: vi.fn(() => pending.promise) } as unknown as RpcClient
    await update(newClient, 'connected')
    expect(tree()).not.toContain('Old host unavailable')
    await act(async () => {
      pending.resolve(historyResponse('Recovered on new client'))
      await pending.promise
    })
    expect(tree()).toContain('Recovered on new client')
  })
})
