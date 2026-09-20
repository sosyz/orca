import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostProfile } from './types'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  tokens: new Map<string, string>(),
  setStorage: vi.fn(),
  setToken: vi.fn(),
  scheduleCleanup: vi.fn(async () => {}),
  supervisorSaveHost: null as null | ((host: HostProfile) => Promise<void>),
  supervisorWriteBundle: null as null | ((bundle: MobileRelayCredentialBundle) => Promise<void>)
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: (key: string, value: string) => mocks.setStorage(key, value),
    removeItem: vi.fn(async (key: string) => {
      mocks.storage.delete(key)
    })
  }
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: (...args: unknown[]) => mocks.setToken(...args),
  getItemAsync: vi.fn(async (key: string) => mocks.tokens.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    mocks.tokens.delete(key)
  })
}))
vi.mock('./host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: vi.fn(async () => {}),
  recordHostCredentialCleanupIntent: vi.fn(async () => {}),
  scheduleHostCredentialCleanup: mocks.scheduleCleanup,
  retryPendingHostCredentialCleanups: vi.fn()
}))
vi.mock('./mobile-endpoint-supervisor', () => ({
  MobileEndpointSupervisor: class {
    constructor(
      _logical: unknown,
      _host: unknown,
      deps: {
        saveHost: (host: HostProfile) => Promise<void>
        writeBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>
      }
    ) {
      mocks.supervisorSaveHost = deps.saveHost
      mocks.supervisorWriteBundle = deps.writeBundle
    }
    start = async () => {}
    setForeground = () => {}
    nudge = () => {}
    stop = () => {}
  }
}))

import {
  getHostPairingEpoch,
  loadHostCatalog,
  loadHosts,
  MobileRelayUpgradeHostChangedError,
  removeHost,
  resetHostStoreForTests,
  saveHost,
  saveHostWithRelayCredential
} from './host-store'
import { resetMobileRelayHostOverlayStoreForTests } from './mobile-relay-host-overlay-store'
import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'
import { writeMobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

const host: HostProfile = {
  id: 'host-a',
  name: 'Original',
  endpoint: 'ws://127.0.0.1:1',
  publicKeyB64: 'key-a',
  deviceToken: 'old-token',
  lastConnected: 0
}
const relayHost: HostProfile = {
  ...host,
  endpoints: [
    { id: 'direct-primary', kind: 'lan', url: host.endpoint },
    {
      id: 'relay-primary',
      kind: 'relay',
      url: 'wss://relay-c1.onorca.dev/v1/connect/AbCdEf0123_-xyZ9'
    }
  ],
  relayHostId: 'AbCdEf0123_-xyZ9',
  relay: {
    v: 1,
    directorUrl: 'https://relay.onorca.dev',
    cellUrl: 'https://relay-c1.onorca.dev',
    assignmentEpoch: 7,
    relayHostId: 'AbCdEf0123_-xyZ9',
    e2eeFraming: 2
  }
}

function credentialFor(profile: HostProfile, token: string): MobileRelayCredentialBundle {
  return {
    v: 1,
    hostId: profile.id,
    deviceToken: profile.deviceToken,
    current: { token, hash: 'B'.repeat(43), version: 1, expiresAt: 9_999_999 }
  }
}

function pauseFirstTokenWrite(): () => void {
  let finish!: () => void
  mocks.setToken.mockImplementationOnce(async (key: string, value: string) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    mocks.tokens.set(key, value)
  })
  return () => finish()
}

beforeEach(() => {
  resetHostStoreForTests()
  resetMobileRelayHostOverlayStoreForTests()
  mocks.storage.clear()
  mocks.tokens.clear()
  mocks.setStorage.mockReset()
  mocks.setStorage.mockImplementation(async (key: string, value: string) => {
    mocks.storage.set(key, value)
  })
  mocks.setToken.mockReset()
  mocks.setToken.mockImplementation(async (key: string, value: string) => {
    mocks.tokens.set(key, value)
  })
  mocks.supervisorSaveHost = null
  mocks.supervisorWriteBundle = null
  const { deviceToken: _token, ...metadata } = host
  mocks.storage.set('orca:hosts', JSON.stringify([metadata]))
})

function startRelayLifecycle(): { stop(): void; saveDelayedRelay(): Promise<void> } {
  const lifecycle = startMobileEndpointLifecycle(
    {} as StableLogicalRpcClient,
    relayHost,
    () => undefined
  )
  const saveHostFromSupervisor = mocks.supervisorSaveHost
  expect(saveHostFromSupervisor).toBeTypeOf('function')
  return {
    stop: () => lifecycle.stop(),
    saveDelayedRelay: () => saveHostFromSupervisor!(relayHost)
  }
}

describe('late relay supervisor publication', () => {
  it('keeps old writers invalid after the new credential succeeds but metadata fails', async () => {
    await saveHost(relayHost)
    const lifecycle = startRelayLifecycle()
    const replacement = { ...relayHost, name: 'Replacement', deviceToken: 'new-token' }
    const newBundle = credentialFor(replacement, 'N'.repeat(43))
    mocks.setStorage.mockImplementation(async (key: string, value: string) => {
      if (key === 'orca:hosts' && value.includes('Replacement')) {
        throw new Error('disk failed')
      }
      mocks.storage.set(key, value)
    })

    await expect(
      saveHostWithRelayCredential(replacement, () => writeMobileRelayCredentialBundle(newBundle))
    ).rejects.toThrow('disk failed')
    await expect(lifecycle.saveDelayedRelay()).rejects.toBeInstanceOf(
      MobileRelayUpgradeHostChangedError
    )
    await expect(
      mocks.supervisorWriteBundle!(credentialFor(relayHost, 'O'.repeat(43)))
    ).rejects.toBeInstanceOf(MobileRelayUpgradeHostChangedError)
    expect(JSON.parse(mocks.tokens.get('orca.mobile-relay.credentials.host-a')!)).toEqual(newBundle)
    expect(await loadHosts()).toEqual([relayHost])
    lifecycle.stop()
  })

  it('blocks old bundle and route writes while a new pairing commits its token', async () => {
    await saveHost(relayHost)
    const lifecycle = startRelayLifecycle()
    const replacement = { ...relayHost, name: 'Replacement', deviceToken: 'new-token' }
    const newBundle = credentialFor(replacement, 'N'.repeat(43))
    let releaseToken!: () => void
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve
    })
    mocks.setToken.mockImplementation(async (key: string, value: string) => {
      if (key === 'orca.host-token.host-a' && value === 'new-token') {
        await tokenGate
      }
      mocks.tokens.set(key, value)
    })

    const pairing = saveHostWithRelayCredential(replacement, () =>
      writeMobileRelayCredentialBundle(newBundle)
    )
    await vi.waitFor(() => expect(mocks.storage.get('orca:hosts')).toContain('Replacement'))
    expect(JSON.parse(mocks.tokens.get('orca.mobile-relay.credentials.host-a')!)).toEqual(newBundle)
    const oldBundleWrite = mocks.supervisorWriteBundle!(credentialFor(relayHost, 'O'.repeat(43)))
    const oldRouteWrite = lifecycle.saveDelayedRelay()
    let loaded = false
    const loading = loadHosts().then((profiles) => {
      loaded = true
      return profiles
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loaded).toBe(false)

    releaseToken()
    await pairing
    await expect(oldBundleWrite).rejects.toBeInstanceOf(MobileRelayUpgradeHostChangedError)
    await expect(oldRouteWrite).rejects.toBeInstanceOf(MobileRelayUpgradeHostChangedError)
    expect(await loading).toEqual([replacement])
    expect(JSON.parse(mocks.tokens.get('orca.mobile-relay.credentials.host-a')!)).toEqual(newBundle)
    lifecycle.stop()
  })

  it('updates relay routing without rewriting the paired host or device token', async () => {
    await saveHost(host)
    const lifecycle = startRelayLifecycle()
    const tokenWrites = mocks.setToken.mock.calls.length

    await lifecycle.saveDelayedRelay()

    expect(await loadHosts()).toEqual([relayHost])
    expect(mocks.setToken).toHaveBeenCalledTimes(tokenWrites)
    expect(JSON.parse(mocks.storage.get('orca:hosts')!)).toEqual([
      {
        id: host.id,
        name: host.name,
        endpoint: host.endpoint,
        publicKeyB64: host.publicKeyB64,
        lastConnected: 0
      }
    ])
    lifecycle.stop()
  })

  it('rejects a delayed save after its lifecycle stops', async () => {
    await saveHost(host)
    const lifecycle = startRelayLifecycle()
    lifecycle.stop()

    await expect(lifecycle.saveDelayedRelay()).rejects.toThrow()
    expect(await loadHosts()).toEqual([host])
  })

  it('cannot resurrect a host removed before its delayed save', async () => {
    await saveHost(host)
    const lifecycle = startRelayLifecycle()
    await removeHost(host.id)

    await expect(lifecycle.saveDelayedRelay()).rejects.toThrow()
    expect(await loadHosts()).toEqual([])
    lifecycle.stop()
  })

  it.each([
    { publicKeyB64: 'new-key', deviceToken: 'new-token' },
    { publicKeyB64: host.publicKeyB64, deviceToken: 'new-token' }
  ])('cannot overwrite a same-id re-pair with identity $publicKeyB64', async (identity) => {
    await saveHost(host)
    const lifecycle = startRelayLifecycle()
    await removeHost(host.id)
    const replacement = {
      ...host,
      ...identity,
      name: 'Replacement',
      endpoint: 'ws://127.0.0.1:2'
    }
    await saveHost(replacement)

    await expect(lifecycle.saveDelayedRelay()).rejects.toThrow()
    expect(await loadHosts()).toEqual([replacement])
    lifecycle.stop()
  })
})

describe('host removal and in-flight re-pairing', () => {
  it('rejects queued recovery publication after a newer pairing takes the host epoch', async () => {
    const finishBlockingToken = pauseFirstTokenWrite()
    const blockingSave = saveHost(host)
    await vi.waitFor(() => expect(mocks.setToken).toHaveBeenCalledOnce())
    const staleEpoch = getHostPairingEpoch(host.id)
    const replacement = { ...relayHost, name: 'Replacement', deviceToken: 'new-token' }
    const newBundle = credentialFor(replacement, 'N'.repeat(43))
    const oldBundle = credentialFor(relayHost, 'O'.repeat(43))
    const newerPairing = saveHostWithRelayCredential(replacement, () =>
      writeMobileRelayCredentialBundle(newBundle)
    )
    const oldWrite = vi.fn(() => writeMobileRelayCredentialBundle(oldBundle))
    const staleRecovery = saveHostWithRelayCredential(relayHost, oldWrite, staleEpoch)

    expect(getHostPairingEpoch(host.id)).toBe(staleEpoch)
    finishBlockingToken()
    await Promise.all([blockingSave, newerPairing])
    await expect(staleRecovery).rejects.toBeInstanceOf(MobileRelayUpgradeHostChangedError)

    expect(oldWrite).not.toHaveBeenCalled()
    expect(await loadHosts()).toEqual([replacement])
    expect(JSON.parse(mocks.tokens.get('orca.mobile-relay.credentials.host-a')!)).toEqual(newBundle)
  })

  it('keeps a new direct host recoverable when its token write fails', async () => {
    const newHost = { ...host, id: 'new-host', publicKeyB64: 'new-key' }
    mocks.setToken.mockRejectedValueOnce(new Error('token write failed'))

    await expect(saveHost(newHost)).rejects.toThrow('token write failed')

    expect((await loadHostCatalog()).find(({ id }) => id === newHost.id)).toMatchObject({
      id: newHost.id,
      publicKeyB64: newHost.publicKeyB64,
      credentialStatus: 'missing',
      profile: null
    })
  })

  it('keeps the newer relay overlay when an older direct token finishes during its publication', async () => {
    const finishOldToken = pauseFirstTokenWrite()
    const savingOldDirect = saveHost(host)
    await vi.waitFor(() => expect(mocks.setToken).toHaveBeenCalledOnce())
    const oldEpoch = getHostPairingEpoch(host.id)
    const replacement = { ...relayHost, name: 'Replacement', deviceToken: 'new-token' }
    const newBundle = credentialFor(replacement, 'N'.repeat(43))
    const writeCredential = vi.fn(() => writeMobileRelayCredentialBundle(newBundle))
    const savingRelay = saveHostWithRelayCredential(replacement, writeCredential)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(getHostPairingEpoch(host.id)).toBe(oldEpoch)
      expect(writeCredential).not.toHaveBeenCalled()
      expect(mocks.storage.get('orca:hosts')).not.toContain('Replacement')
      finishOldToken()
      await Promise.all([savingOldDirect, savingRelay])

      expect(await loadHosts()).toEqual([replacement])
      expect(JSON.parse(mocks.tokens.get('orca.mobile-relay.credentials.host-a')!)).toEqual(
        newBundle
      )
    } finally {
      finishOldToken()
      await Promise.allSettled([savingOldDirect, savingRelay])
    }
  })

  it('does not attach an old relay overlay to a new direct pairing of the same id', async () => {
    const finishOldToken = pauseFirstTokenWrite()
    const savingOldRelay = saveHost(relayHost)
    await vi.waitFor(() => expect(mocks.setToken).toHaveBeenCalledOnce())
    const removing = removeHost(host.id)
    const savingDirect = saveHost({
      ...host,
      name: 'Replacement',
      deviceToken: 'new-token',
      endpoint: 'ws://127.0.0.1:2'
    })
    finishOldToken()
    await Promise.all([savingOldRelay, removing, savingDirect])

    const loaded = await loadHosts()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      name: 'Replacement',
      deviceToken: 'new-token',
      endpoint: 'ws://127.0.0.1:2'
    })
    expect(loaded[0]?.relay).toBeUndefined()
    expect(loaded[0]?.endpoints).toBeUndefined()
  })

  it('does not republish relay routing after a host was removed during its token save', async () => {
    const finishOldToken = pauseFirstTokenWrite()
    const saving = saveHost(relayHost)
    await vi.waitFor(() => expect(mocks.setToken).toHaveBeenCalledOnce())
    const removing = removeHost(host.id)
    finishOldToken()
    await Promise.all([saving, removing])

    expect(JSON.parse(mocks.storage.get('orca:hosts')!)).toEqual([])
    expect(JSON.parse(mocks.storage.get('orca:mobile-relay:host-overlays:v2') ?? '[]')).toEqual([])
    expect(await loadHosts()).toEqual([])
  })

  it('keeps a new relay pairing when an older direct save finishes after deletion', async () => {
    const finishOldToken = pauseFirstTokenWrite()
    const savingOldDirect = saveHost(host)
    await vi.waitFor(() => expect(mocks.setToken).toHaveBeenCalledOnce())
    const removing = removeHost(host.id)
    const savingRelay = saveHost({ ...relayHost, name: 'Replacement', deviceToken: 'new-token' })
    finishOldToken()
    await Promise.all([savingOldDirect, removing, savingRelay])

    expect(await loadHosts()).toEqual([
      { ...relayHost, name: 'Replacement', deviceToken: 'new-token' }
    ])
  })
})
