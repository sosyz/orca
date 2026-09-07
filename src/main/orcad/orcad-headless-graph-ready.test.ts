import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RuntimeForRpc = {
  createMobileSessionTerminal: (worktree: string, options: unknown) => Promise<unknown>
}

type RuntimeRecord = RuntimeForRpc & {
  syncWindowGraph: (windowId: number, graph: { tabs: unknown[]; leaves: unknown[] }) => unknown
}

const harness = vi.hoisted(() => ({
  events: [] as string[],
  runtimes: [] as RuntimeRecord[],
  instanceRelease: vi.fn(),
  readinessPublish: vi.fn(async () => {}),
  resolveBrowserProvider: vi.fn(async () => null),
  setRuntimeBrowserCommandsFactory: vi.fn(),
  setAppEnvironment: vi.fn(),
  setSecretStore: vi.fn(),
  registerHeadlessPtyRuntime: vi.fn(async () => {}),
  startOrcadDaemon: vi.fn(async () => {}),
  stopOrcadDaemon: vi.fn(async () => {}),
  collectOrcadHealth: vi.fn(async () => ({ status: 'ok' }))
}))

vi.mock('../../shared/app-environment', () => {
  let environment: { getPath: (name: string) => string; getVersion: () => string } | null = null
  return {
    setAppEnvironment: vi.fn((next) => {
      environment = next
      harness.setAppEnvironment(next)
    }),
    getAppEnvironment: vi.fn(() => {
      if (!environment) {
        throw new Error('app environment was not installed')
      }
      return environment
    })
  }
})

vi.mock('../../shared/secret-store', () => ({
  setSecretStore: harness.setSecretStore
}))

vi.mock('./orcad-app-paths', () => ({
  resolveOrcadInstallRoot: () => '/fixture/orcad',
  resolveOrcadPath: (name: string) => `/fixture/orcad/${name}`,
  resolveUserDataPath: () => '/fixture/orcad/userData'
}))

vi.mock('./orcad-browser-provider', () => ({
  resolveOrcadBrowserProvider: harness.resolveBrowserProvider
}))

vi.mock('../runtime/runtime-browser-commands-factory', () => ({
  setRuntimeBrowserCommandsFactory: harness.setRuntimeBrowserCommandsFactory
}))

vi.mock('./orcad-instance-lock', () => ({
  OrcadInstanceLockError: class OrcadInstanceLockError extends Error {},
  acquireOrcadInstanceLock: vi.fn(() => {
    harness.events.push('instance-lock')
    return { release: harness.instanceRelease }
  })
}))

vi.mock('../runtime/orca-runtime', () => ({
  OrcaRuntimeService: class MockOrcaRuntimeService {
    private graphReady = false

    syncWindowGraph = vi.fn((windowId: number) => {
      harness.events.push(`graph:${windowId}`)
      this.graphReady = windowId === 0
      return { graphStatus: this.graphReady ? 'ready' : 'unavailable' }
    })

    constructor() {
      harness.events.push('runtime')
      harness.runtimes.push(this as RuntimeRecord)
    }

    getRuntimeId(): string {
      return 'runtime-1'
    }

    rehydrateClientHostedBrowserPages(): void {
      harness.events.push('browser-rehydrate')
    }

    async refreshRestoredOrchestrationAuthority(): Promise<void> {
      harness.events.push('orchestration-authority')
    }

    async reconcileLegacyWorkerTerminals(): Promise<void> {
      harness.events.push('legacy-workers')
    }

    async createMobileSessionTerminal(): Promise<{ tab: { id: string; type: string } }> {
      harness.events.push(`mobile-create:${this.graphReady ? 'ready' : 'unavailable'}`)
      if (!this.graphReady) {
        throw Object.assign(new Error('runtime_unavailable'), { code: 'runtime_unavailable' })
      }
      return { tab: { id: 'tab-1::leaf-1', type: 'terminal' } }
    }
  }
}))

vi.mock('../runtime/runtime-rpc', () => ({
  OrcaRuntimeRpcServer: class MockOrcaRuntimeRpcServer {
    start = vi.fn(async () => {
      harness.events.push('rpc-start')
      await this.runtime.createMobileSessionTerminal('id:wt-1', {
        activate: false,
        navigation: 'caller',
        select: true
      })
    })

    stop = vi.fn(async () => {
      harness.events.push('rpc-stop')
    })

    constructor(private readonly options: { runtime: RuntimeForRpc }) {
      harness.events.push('rpc')
    }

    private get runtime(): RuntimeForRpc {
      return this.options.runtime
    }

    getWebSocketEndpoint(): string {
      return 'ws://127.0.0.1:17669'
    }

    createPairingOffer(): { available: false; reason: string; guidance: string } {
      return {
        available: false,
        reason: 'disabled_by_operator',
        guidance: 'disabled'
      }
    }
  }
}))

vi.mock('../ipc/pty', () => ({
  registerHeadlessPtyRuntime: vi.fn(async () => {
    harness.events.push('headless-pty')
    await harness.registerHeadlessPtyRuntime()
  }),
  getLocalPtyProvider: () => null,
  getSshPtyProvider: () => null
}))

vi.mock('../runtime/pairing-endpoint', () => ({
  resolveAdvertisedPairingEndpoint: () => ({ ok: true, endpoint: 'ws://127.0.0.1:17669' })
}))

vi.mock('../server/serve-readiness', () => ({
  ServeReadinessPublisher: class MockServeReadinessPublisher {
    async publish(): Promise<void> {
      harness.events.push('readiness')
      await harness.readinessPublish()
    }
  }
}))

vi.mock('../persistence/loading-store/store', () => ({
  Store: class MockStore {
    constructor() {
      harness.events.push('store')
    }

    getSettings(): Record<string, never> {
      return {}
    }
  }
}))

vi.mock('../orca-profiles/profile-index-store', () => ({
  initOrcaProfilePaths: vi.fn(() => {
    harness.events.push('profile-paths')
  }),
  ensureActiveOrcaProfile: vi.fn(() => {
    harness.events.push('profile')
    return { dataFile: '/fixture/orcad/profile.json' }
  })
}))

vi.mock('../ssh/ssh-host-key-store', () => ({
  initSshHostKeyStoreFile: vi.fn(() => {
    harness.events.push('ssh-host-keys')
  })
}))

vi.mock('./orcad-daemon-supervision', () => ({
  startOrcadDaemon: vi.fn(async () => {
    harness.events.push('daemon-start')
    await harness.startOrcadDaemon()
  }),
  stopOrcadDaemon: vi.fn(async () => {
    harness.events.push('daemon-stop')
    await harness.stopOrcadDaemon()
  })
}))

vi.mock('../daemon/daemon-init', () => ({
  daemonOwnsFreshPersistentPtys: () => true
}))

vi.mock('./orcad-health', () => ({
  collectOrcadHealth: vi.fn(async () => {
    harness.events.push('health')
    return harness.collectOrcadHealth()
  })
}))

import { startOrcad } from './orcad-entry'

describe('orcad headless graph readiness', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    harness.events.length = 0
    harness.runtimes.length = 0
    harness.instanceRelease.mockClear()
    harness.readinessPublish.mockClear()
    harness.resolveBrowserProvider.mockClear()
    harness.setRuntimeBrowserCommandsFactory.mockClear()
    harness.setAppEnvironment.mockClear()
    harness.setSecretStore.mockClear()
    harness.registerHeadlessPtyRuntime.mockClear()
    harness.startOrcadDaemon.mockClear()
    harness.stopOrcadDaemon.mockClear()
    harness.collectOrcadHealth.mockClear()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('publishes an empty headless graph before mobile terminal RPCs can run', async () => {
    const handle = await startOrcad({ noPairing: true })
    const runtime = harness.runtimes[0]
    const graphIndex = harness.events.indexOf('graph:0')
    const rpcStartIndex = harness.events.indexOf('rpc-start')

    expect(runtime.syncWindowGraph).toHaveBeenCalledWith(0, { tabs: [], leaves: [] })
    expect(graphIndex).toBeGreaterThan(harness.events.indexOf('legacy-workers'))
    expect(rpcStartIndex).toBeGreaterThan(graphIndex)
    expect(harness.events).toContain('mobile-create:ready')
    expect(harness.events).not.toContain('mobile-create:unavailable')

    await handle.stop()
  })
})
