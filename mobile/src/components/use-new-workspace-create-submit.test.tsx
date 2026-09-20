import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNewWorkspaceCreateSubmit } from './use-new-workspace-create-submit'

const createWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../tasks/blank-workspace-create', () => ({ createBlankWorkspace: createWorkspace }))

type Options = Parameters<typeof useNewWorkspaceCreateSubmit>[0]
type Controller = ReturnType<typeof useNewWorkspaceCreateSubmit>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const renderers: ReactTestRenderer[] = []
function mountController(overrides: Partial<Options> = {}) {
  const options: Options = {
    visible: true,
    client: {
      sendRequest: vi.fn().mockResolvedValue({ ok: true, result: { settings: {} } })
    } as unknown as RpcClient,
    selectedRepo: { id: 'repo-a', displayName: 'Project A', path: '/repo-a', kind: 'git' },
    selectedAgent: { id: '__blank__', label: 'Blank' },
    setSelectedAgent: vi.fn(),
    setAgentOverridden: vi.fn(),
    runtimeSettings: null,
    setRuntimeSettings: vi.fn(),
    detectedAgentIds: null,
    sshGate: { requiresConnection: false } as Options['sshGate'],
    composer: {
      name: 'workspace-a',
      createSelection: null,
      isNameAutoManaged: false
    } as Options['composer'],
    note: '',
    retiredWorktreeNames: {},
    setupCommand: null,
    setupTrust: null,
    setupRunPolicy: 'ask',
    setupDecisionChoice: null,
    runSetup: false,
    trustedOrcaHooks: {},
    setTrustedOrcaHooks: vi.fn(),
    getWorktreeCreateCutoverSupport: vi.fn().mockResolvedValue(false),
    transitionDrawer: vi.fn(),
    setError: vi.fn(),
    onCreated: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  let latest!: Controller
  function Harness() {
    latest = useNewWorkspaceCreateSubmit({ ...options })
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness))
  })
  renderers.push(renderer)
  return {
    options,
    get current() {
      return latest
    },
    hide: () =>
      act(() => {
        options.visible = false
        renderer.update(createElement(Harness))
      }),
    unmount: () => act(() => renderer.unmount())
  }
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    act(() => renderer.unmount())
  }
  vi.clearAllMocks()
})

describe('new workspace create drawer lifetime', () => {
  it('does not close a reopened drawer or navigate when an old create finishes', async () => {
    const result = deferred<{ worktreeId: string; name: string }>()
    createWorkspace.mockReturnValue(result.promise)
    const old = mountController()
    let pending!: Promise<void>
    await act(async () => {
      pending = old.current.create()
    })
    expect(createWorkspace).toHaveBeenCalledOnce()
    old.hide()
    old.unmount()
    const reopened = mountController()
    await act(async () => {
      result.resolve({ worktreeId: 'created-a', name: 'workspace-a' })
      await pending
    })
    expect(old.options.onClose).not.toHaveBeenCalled()
    expect(old.options.onCreated).not.toHaveBeenCalled()
    expect(reopened.current.creating).toBe(false)
  })

  it('stops before starting creation if settings preflight finishes after dismissal', async () => {
    const settings = deferred<unknown>()
    const sendRequest = vi.fn().mockReturnValue(settings.promise)
    const harness = mountController({ client: { sendRequest } as unknown as RpcClient })
    let pending!: Promise<void>
    act(() => {
      pending = harness.current.create()
    })
    harness.hide()
    await act(async () => {
      settings.resolve({ ok: true, result: { settings: {} } })
      await pending
    })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(harness.options.setRuntimeSettings).not.toHaveBeenCalled()
  })

  it('still closes and opens the created workspace for the active drawer', async () => {
    createWorkspace.mockResolvedValue({ worktreeId: 'created-a', name: 'workspace-a' })
    const harness = mountController()
    await act(async () => {
      await harness.current.create()
    })
    expect(harness.options.onClose).toHaveBeenCalledOnce()
    expect(harness.options.onCreated).toHaveBeenCalledWith('created-a', 'workspace-a')
    expect(harness.current.creating).toBe(false)
  })

  it('does not create after a dismissed setup approval finishes persisting', async () => {
    const approval = deferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementation((method: string) =>
        method === 'ui.set'
          ? approval.promise
          : Promise.resolve({ ok: true, result: { settings: {} } })
      )
    const harness = mountController({
      client: { sendRequest } as unknown as RpcClient,
      setupCommand: 'pnpm install',
      setupTrust: { contentHash: 'setup-hash', scriptContent: 'pnpm install' },
      setupDecisionChoice: 'run'
    })
    await act(async () => {
      await harness.current.create()
    })
    expect(harness.current.setupTrustPrompt?.contentHash).toBe('setup-hash')
    let pending!: Promise<void>
    act(() => {
      pending = harness.current.approveSetupTrust(false)
    })
    harness.hide()
    await act(async () => {
      approval.resolve({ ok: true, result: {} })
      await pending
    })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(harness.options.setTrustedOrcaHooks).not.toHaveBeenCalled()
    expect(harness.options.onCreated).not.toHaveBeenCalled()
  })

  it('does not surface a dismissed request error in a newer drawer', async () => {
    const result = deferred<{ error: string }>()
    createWorkspace.mockReturnValue(result.promise)
    const harness = mountController()
    let pending!: Promise<void>
    await act(async () => {
      pending = harness.current.create()
    })
    harness.hide()
    await act(async () => {
      result.resolve({ error: 'Old creation failed' })
      await pending
    })
    expect(harness.options.setError).toHaveBeenCalledExactlyOnceWith('')
  })
})
