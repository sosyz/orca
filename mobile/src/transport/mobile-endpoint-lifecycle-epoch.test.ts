import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostProfile } from './types'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

const mocks = vi.hoisted(() => ({
  epoch: 1,
  onUpgraded: null as null | ((result: { host: HostProfile }) => Promise<void>),
  stopController: vi.fn(),
  createSupervisor: vi.fn()
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('./host-store', () => ({
  getHostPairingEpoch: () => mocks.epoch,
  saveExistingHostRelayUpgrade: vi.fn(),
  writeForCurrentHostPairing: vi.fn()
}))
vi.mock('./mobile-relay-direct-upgrade-controller', () => ({
  MobileRelayDirectUpgradeController: class {
    constructor(_logical: unknown, _host: unknown, deps: { onUpgraded: typeof mocks.onUpgraded }) {
      mocks.onUpgraded = deps.onUpgraded
    }
    start = async () => {}
    setForeground = () => {}
    nudge = () => {}
    stop = mocks.stopController
  }
}))
vi.mock('./mobile-endpoint-supervisor', () => ({
  MobileEndpointSupervisor: class {
    constructor() {
      mocks.createSupervisor()
    }
    start = async () => {}
    setForeground = () => {}
    nudge = () => {}
    stop = () => {}
  }
}))

import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'

const directHost: HostProfile = {
  id: 'host-a',
  name: 'Original',
  endpoint: 'ws://127.0.0.1:1',
  deviceToken: 'old-token',
  publicKeyB64: 'key-a',
  lastConnected: 0
}

describe('direct upgrade owner handoff', () => {
  beforeEach(() => {
    mocks.epoch = 1
    mocks.onUpgraded = null
    mocks.stopController.mockClear()
    mocks.createSupervisor.mockClear()
  })

  it('does not give an old upgrade a new pairing epoch after its final await', async () => {
    const lifecycle = startMobileEndpointLifecycle(
      {} as StableLogicalRpcClient,
      directHost,
      () => undefined
    )
    mocks.epoch = 2

    await mocks.onUpgraded!({ host: { ...directHost, relayHostId: 'AbCdEf0123_-xyZ9' } })

    expect(mocks.stopController).toHaveBeenCalledOnce()
    expect(mocks.createSupervisor).not.toHaveBeenCalled()
    lifecycle.stop()
  })
})
