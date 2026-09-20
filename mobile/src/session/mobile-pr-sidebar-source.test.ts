import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../src/shared/github/pull-request-types'
import type { GitHubWorkItemDetails } from '../../../src/shared/github/work-item-types'
import type { RpcClient } from '../transport/rpc-client'
import { useMobilePrSidebarController } from './use-mobile-pr-sidebar-controller'

const rpc = vi.hoisted(() => ({ probe: vi.fn(), pr: vi.fn(), details: vi.fn() }))
vi.mock('./github-pr-rpc', () => ({
  fetchGithubRepoSlug: (...args: unknown[]) => rpc.probe(...args),
  fetchHostedReviewForBranch: async () => ({ ok: true, result: null }),
  fetchPRForBranch: (...args: unknown[]) => rpc.pr(...args),
  fetchPRChecks: async () => ({ ok: true, result: [] }),
  fetchWorkItemDetails: (...args: unknown[]) => rpc.details(...args)
}))
vi.mock('../source-control/mobile-pr-link', () => ({ fetchWorktreeLinkedPR: async () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const ok = <T>(result: T) => ({ ok: true as const, result })
const pr = (title: string): PRInfo =>
  ({ number: 7, title, state: 'open', headSha: 'head' }) as PRInfo
const details = (body: string): GitHubWorkItemDetails =>
  ({ item: { id: 'pr:7', number: 7, type: 'pr' }, body, comments: [] }) as GitHubWorkItemDetails
type Input = Parameters<typeof useMobilePrSidebarController>[0]

describe('PR sidebar read ownership', () => {
  let renderer: ReactTestRenderer | null = null
  let current!: ReturnType<typeof useMobilePrSidebarController>
  let input: Input
  function Harness(props: Input) {
    current = useMobilePrSidebarController(props)
    return null
  }
  async function render(next = input) {
    input = next
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, input))
      } else {
        renderer = create(createElement(Harness, input))
      }
    })
  }
  async function load(includeDetails = true) {
    await act(async () => current.refetchPRSidebar({ includeDetails }))
  }
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.probe.mockResolvedValue(ok({ owner: 'o', repo: 'r' }))
    rpc.pr.mockResolvedValue(ok(pr('Original')))
    rpc.details.mockResolvedValue(ok(details('Original body')))
    input = {
      client: { sendRequest: vi.fn() } as unknown as RpcClient,
      worktreeId: 'worktree',
      branch: 'feature',
      headSha: 'head',
      connState: 'connected'
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('hides old ready data and repo eligibility while a replacement client is loading', async () => {
    await render()
    await load()
    expect(current.prSidebarState.kind).toBe('ready')
    rpc.probe.mockReturnValueOnce(new Promise(() => {}))
    await render({ ...input, client: { sendRequest: vi.fn() } as unknown as RpcClient })
    expect(current.prSidebarState.kind).toBe('hidden')
    expect(current.prSidebarRepoProbeLoaded).toBe(false)
    expect(current.prSidebarIsGithubRepo).toBe(false)
  })

  it('does not adopt an old client phase-one result or start its heavy details read', async () => {
    const pending = deferred<ReturnType<typeof ok<PRInfo>>>()
    rpc.pr.mockReturnValueOnce(pending.promise)
    await render()
    let loading!: Promise<void>
    await act(async () => {
      loading = current.refetchPRSidebar()
    })
    await render({ ...input, client: { sendRequest: vi.fn() } as unknown as RpcClient })
    await act(async () => {
      pending.resolve(ok(pr('Old client')))
      await loading
    })
    expect(current.prSidebarState.kind).toBe('hidden')
    expect(rpc.details).not.toHaveBeenCalled()
  })

  it('does not merge old client comments into the replacement PR with the same number', async () => {
    const pending = deferred<ReturnType<typeof ok<GitHubWorkItemDetails>>>()
    rpc.details.mockReturnValueOnce(pending.promise)
    await render()
    let loading!: Promise<void>
    await act(async () => {
      loading = current.refetchPRSidebar()
    })
    await render({ ...input, client: { sendRequest: vi.fn() } as unknown as RpcClient })
    rpc.pr.mockResolvedValue(ok(pr('Replacement')))
    await load(false)
    await act(async () => {
      pending.resolve(ok(details('Wrong host comments')))
      await loading
    })
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Replacement' }, details: null }
    })
  })

  it('rejects old refresh callbacks after a branch switch', async () => {
    await render()
    const oldRefresh = current.refetchPRSidebar
    await render({ ...input, branch: 'replacement' })
    await act(async () => oldRefresh())
    expect(rpc.pr).not.toHaveBeenCalled()
    expect(current.prSidebarState.kind).toBe('hidden')
  })

  it('does not begin phase two after the reader unmounts', async () => {
    const pending = deferred<ReturnType<typeof ok<PRInfo>>>()
    rpc.pr.mockReturnValueOnce(pending.promise)
    await render()
    let loading!: Promise<void>
    await act(async () => {
      loading = current.refetchPRSidebar()
    })
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      pending.resolve(ok(pr('Unmounted')))
      await loading
    })
    expect(rpc.details).not.toHaveBeenCalled()
  })

  it('retains confirmed PR details and eligibility across a same-client disconnection', async () => {
    await render()
    await load()
    const loaded = current.prSidebarState
    await render({ ...input, connState: 'disconnected' })
    expect(current.prSidebarState).toBe(loaded)
    expect(current.prSidebarRepoProbeLoaded).toBe(true)
    expect(current.prSidebarIsGithubRepo).toBe(true)
  })

  it('keeps the loaded conversation visible while refreshing a newer HEAD on the same branch', async () => {
    await render()
    await load()
    const loaded = current.prSidebarState
    expect(loaded).toMatchObject({ kind: 'ready', data: { details: { body: 'Original body' } } })
    const pending = deferred<ReturnType<typeof ok<PRInfo>>>()
    rpc.pr.mockReturnValueOnce(pending.promise)
    await render({ ...input, headSha: 'new-head' })
    expect(current.prSidebarState).toBe(loaded)
    rpc.details.mockResolvedValue(ok(details('Updated body')))
    await act(async () => pending.resolve(ok({ ...pr('Updated'), headSha: 'new-head' })))
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Updated' }, details: { body: 'Updated body' } }
    })
    expect(rpc.details).toHaveBeenCalledTimes(2)
  })

  it('clears old comments before a same-number PR from another repository loads its details', async () => {
    rpc.pr.mockResolvedValue(ok({ ...pr('Repo A'), prRepo: { owner: 'o', repo: 'A' } }))
    await render()
    await load()
    const pending = deferred<ReturnType<typeof ok<GitHubWorkItemDetails>>>()
    rpc.pr.mockResolvedValue(ok({ ...pr('Repo B'), prRepo: { owner: 'o', repo: 'B' } }))
    rpc.details.mockReturnValueOnce(pending.promise)
    await render({ ...input, headSha: 'new-head' })
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Repo B' }, details: null }
    })
    await act(async () => pending.resolve(ok(details('Repo B body'))))
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { details: { body: 'Repo B body' } }
    })
  })

  it('rejects old same-number details after a chip-only refresh discovers another repo', async () => {
    const pending = deferred<ReturnType<typeof ok<GitHubWorkItemDetails>>>()
    rpc.pr.mockResolvedValue(ok({ ...pr('Repo A'), prRepo: { owner: 'o', repo: 'A' } }))
    rpc.details.mockReturnValueOnce(pending.promise)
    await render()
    let oldLoad!: Promise<void>
    await act(async () => {
      oldLoad = current.refetchPRSidebar()
    })
    rpc.pr.mockResolvedValue(ok({ ...pr('Repo B'), prRepo: { owner: 'o', repo: 'B' } }))
    await load(false)
    const replacement = deferred<ReturnType<typeof ok<GitHubWorkItemDetails>>>()
    rpc.details.mockReturnValueOnce(replacement.promise)
    let replacementRead!: Promise<void>
    await act(async () => {
      replacementRead = current.ensurePrSidebarDetails()
    })
    expect(rpc.details).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending.resolve(ok(details('Repo A body')))
      await oldLoad
    })
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Repo B' }, details: null }
    })
    await act(async () => {
      replacement.resolve(ok(details('Repo B body')))
      await replacementRead
    })
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Repo B' }, details: { body: 'Repo B body' } }
    })
  })

  it('preserves details for an equivalent default GitHub repository identity', async () => {
    rpc.pr.mockResolvedValue(ok({ ...pr('Repo A'), prRepo: { owner: 'Owner', repo: 'Repo' } }))
    await render()
    await load()
    const previous = current.prSidebarState
    rpc.pr.mockResolvedValue(
      ok({ ...pr('Refreshed'), prRepo: { owner: 'owner', repo: 'repo', host: 'github.com' } })
    )
    await load(false)
    expect(current.prSidebarState).toMatchObject({
      kind: 'ready',
      data: { pr: { title: 'Refreshed' }, details: { body: 'Original body' } }
    })
    if (current.prSidebarState.kind === 'ready' && previous.kind === 'ready') {
      expect(current.prSidebarState.data.details).toBe(previous.data.details)
    }
  })
})
