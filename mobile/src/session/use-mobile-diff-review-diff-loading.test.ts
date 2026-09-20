import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileDiffReviewQueueItem } from './mobile-diff-review-queue'
import type { ReviewDiffState, ReviewScreenState } from './mobile-diff-review-screen-model'
import { useMobileDiffReviewDiffLoading } from './use-mobile-diff-review-diff-loading'

const loadDiff = vi.hoisted(() => vi.fn())
vi.mock('./mobile-diff-review-loaders', () => ({ loadMobileDiffReviewDiff: loadDiff }))

const client = { sendRequest: vi.fn() } as unknown as RpcClient
// Stable identity, like the controller's useState setter: it is an effect dependency.
const setActiveHunkIndex = () => {}
const currentItem = {
  key: 'item-1',
  filePath: 'src/app.ts',
  scope: 'unstaged',
  status: 'modified'
} as MobileDiffReviewQueueItem
const readyScreen = { kind: 'ready', branchCompare: null } as unknown as ReviewScreenState

function readyDiff(firstLine: string): ReviewDiffState {
  return {
    kind: 'ready',
    itemKey: 'item-1',
    lines: [{ kind: 'context', text: firstLine }],
    hunks: [],
    truncated: false
  } as unknown as ReviewDiffState
}

describe('useMobileDiffReviewDiffLoading', () => {
  let renderer: ReactTestRenderer | null = null
  let diffState: ReviewDiffState = { kind: 'idle' }
  let inputClient = client
  let inputWorktreeId = 'wt-1'
  let inputHostId = 'host-1'
  const frames: ReviewDiffState[] = []

  function Probe({ connState }: { connState: ConnectionState }): null {
    diffState = useMobileDiffReviewDiffLoading({
      client: inputClient,
      connState,
      hostId: inputHostId,
      worktreeId: inputWorktreeId,
      currentItem,
      screenState: readyScreen,
      setActiveHunkIndex
    })
    useLayoutEffect(() => {
      frames.push(diffState)
    })
    return null
  }

  async function render(connState: ConnectionState): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Probe, { connState }))
      await Promise.resolve()
    })
  }

  async function update(connState: ConnectionState): Promise<void> {
    await act(async () => {
      renderer?.update(createElement(Probe, { connState }))
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    loadDiff.mockReset()
    inputClient = client
    inputWorktreeId = 'wt-1'
    inputHostId = 'host-1'
    frames.length = 0
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the loaded diff when the reconnect refetch rejects', async () => {
    loadDiff
      .mockResolvedValueOnce(readyDiff('before the drop'))
      .mockRejectedValueOnce(new Error('diff fetch failed'))

    await render('connected')
    expect(diffState).toMatchObject({ kind: 'ready' })

    await update('reconnecting')
    await update('connected')
    // Why (F10): a failed refetch must not erase the diff (or hunk context) on screen.
    expect(diffState).toMatchObject({ kind: 'ready', lines: [{ text: 'before the drop' }] })
    expect(loadDiff).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded diff through a disconnect and its reconnect refetch', async () => {
    let releaseRefetch: (() => void) | null = null
    loadDiff.mockResolvedValueOnce(readyDiff('before the drop')).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRefetch = () => resolve(readyDiff('after the drop'))
        })
    )

    await render('connected')
    expect(diffState).toMatchObject({ kind: 'ready' })

    await update('reconnecting')
    expect(diffState).toMatchObject({ kind: 'ready', lines: [{ text: 'before the drop' }] })

    await update('connected')
    expect(diffState).toMatchObject({ kind: 'ready', lines: [{ text: 'before the drop' }] })

    await act(async () => {
      releaseRefetch?.()
      await Promise.resolve()
    })
    expect(diffState).toMatchObject({ kind: 'ready', lines: [{ text: 'after the drop' }] })
    expect(loadDiff).toHaveBeenCalledTimes(2)
  })

  it('waits for the desktop when the drop lands before any diff is loaded', async () => {
    loadDiff.mockReturnValueOnce(new Promise(() => {}))

    await render('connected')
    expect(diffState).toMatchObject({ kind: 'loading', itemKey: 'item-1' })

    await update('disconnected')
    expect(diffState).toMatchObject({ kind: 'error', message: 'Waiting for desktop...' })
  })

  it.each(['client', 'host', 'worktree'])(
    'does not retain a same-key diff after %s changes',
    async (change) => {
      loadDiff
        .mockResolvedValueOnce(readyDiff('previous source'))
        .mockReturnValueOnce(new Promise(() => {}))
      await render('connected')
      frames.length = 0
      if (change === 'client') {
        inputClient = { sendRequest: vi.fn() } as unknown as RpcClient
      } else if (change === 'host') {
        inputHostId = 'host-2'
      } else {
        inputWorktreeId = 'wt-2'
      }
      await update('connected')
      expect(frames.every((frame) => frame.kind !== 'ready')).toBe(true)
      expect(diffState.kind).toBe('loading')
      expect(loadDiff).toHaveBeenCalledTimes(2)
    }
  )
})
