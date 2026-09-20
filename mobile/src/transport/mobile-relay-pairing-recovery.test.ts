import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { hashMobileRelayCredential } from './mobile-relay-credential-hash'
import { createMobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import {
  recoverMobileRelayPairing,
  resetMobileRelayPairingRecoveryForTests
} from './mobile-relay-pairing-recovery'
import type { PairingCandidateClient } from './mobile-relay-physical-client'
import type { HostProfile, PairingOffer, RpcResponse } from './types'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn() }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED' }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))

const now = Date.UTC(2026, 6, 13)
const offer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  relay: {
    v: 1,
    directorUrl: 'https://relay.onorca.dev',
    cellUrl: 'https://relay-c1.onorca.dev',
    assignmentEpoch: 7,
    relayHostId: 'AbCdEf0123_-xyZ9',
    inviteToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678',
    inviteExpiresAt: now + 300_000,
    e2eeFraming: 2
  }
} satisfies PairingOffer

function response(result: unknown): RpcResponse {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function installed(
  journal: ReturnType<typeof journal>,
  mode: 'authenticated-direct' | 'relay-basis'
) {
  return {
    v: 1 as const,
    reqId: journal.metadata.installReqId,
    authorizationMode: mode,
    currentVersion: 1,
    resumeExpiresAt: now + 86_400_000
  }
}

function endpoints(
  journal: ReturnType<typeof journal>,
  state: { state: 'not-found' } | { state: 'committed'; result: ReturnType<typeof installed> }
) {
  return {
    v: 1 as const,
    relay: {
      v: 1 as const,
      directorUrl: offer.relay.directorUrl,
      cellUrl: offer.relay.cellUrl,
      assignmentEpoch: offer.relay.assignmentEpoch,
      relayHostId: offer.relay.relayHostId,
      e2eeFraming: 2 as const
    },
    installStatus: { v: 1 as const, reqId: journal.metadata.installReqId, ...state }
  }
}

function journal(mode: 'authenticated-direct' | 'relay-basis' = 'authenticated-direct') {
  const value = createMobileRelayPairingJournal({
    offer: offer as PairingOffer & { relay: NonNullable<PairingOffer['relay']> },
    hostId: 'host-1',
    hostName: 'Blue Whale',
    now,
    randomBytes: (length) => new Uint8Array(length).fill(length)
  })
  return {
    ...value,
    metadata: {
      ...value.metadata,
      winner: mode === 'authenticated-direct' ? ('direct' as const) : ('relay' as const),
      authorizationMode: mode
    }
  }
}

function client(handler: (method: string, params: unknown) => Promise<RpcResponse>) {
  return { sendRequest: vi.fn(handler), close: vi.fn() } satisfies PairingCandidateClient
}

function dependencies(args: {
  journal: ReturnType<typeof journal>
  connectRelay: ReturnType<typeof vi.fn>
  bundle?: MobileRelayCredentialBundle | null
}) {
  const deps = {
    loadJournal: vi.fn(async () => args.journal),
    updateJournal: vi.fn(async (_id, update) => {
      Object.assign(args.journal.metadata, update(args.journal.metadata))
    }),
    clearJournal: vi.fn(async () => {}),
    readCredentialBundle: vi.fn(async () => args.bundle ?? null),
    writeCredentialBundle: vi.fn(async () => {}),
    getHostPairingEpoch: vi.fn(() => 0),
    loadHosts: vi.fn(async (): Promise<HostProfile[]> => []),
    saveExistingHostRelayUpgrade: vi.fn(async () => {}),
    connectRelay: args.connectRelay,
    resolveInviteDirector: vi.fn(async () => {
      throw new Error('director not needed')
    }),
    now: () => now,
    platform: 'ios'
  }
  return {
    ...deps,
    saveHostWithRelayCredential: vi.fn(
      async (_host: HostProfile, writeCredential: () => Promise<void>) => {
        await writeCredential()
      }
    )
  }
}

describe('mobile relay pairing recovery', () => {
  beforeEach(() => {
    resetMobileRelayPairingRecoveryForTests()
  })

  it.each([
    { storedToken: 'old-device-token', storedHash: 'pending' },
    { storedToken: offer.deviceToken, storedHash: 'D'.repeat(43) }
  ])(
    'reconciles a same-id pairing instead of clearing its journal with $storedToken',
    async ({ storedToken, storedHash }) => {
      const saved = journal()
      const committed = installed(saved, 'authenticated-direct')
      const connected = client(async () =>
        response(endpoints(saved, { state: 'committed', result: committed }))
      )
      const deps = dependencies({
        journal: saved,
        connectRelay: vi.fn(() => connected),
        bundle: {
          v: 1,
          hostId: saved.metadata.host.id,
          deviceToken: saved.secrets.deviceToken,
          current: {
            token: 'C'.repeat(43),
            hash: storedHash === 'pending' ? saved.metadata.pendingResumeTokenHash : storedHash,
            version: 1,
            expiresAt: now + 60_000
          }
        }
      })
      let publishedHost: HostProfile = {
        id: saved.metadata.host.id,
        name: 'Old host',
        endpoint: offer.endpoint,
        publicKeyB64: offer.publicKeyB64,
        deviceToken: storedToken,
        lastConnected: 0,
        relayHostId: offer.relay.relayHostId
      }
      deps.saveHostWithRelayCredential.mockImplementation(async (host, writeCredential) => {
        await writeCredential()
        publishedHost = host
      })

      await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
      expect(deps.connectRelay).toHaveBeenCalled()
      expect(deps.saveHostWithRelayCredential).toHaveBeenCalledOnce()
      expect(publishedHost.deviceToken).toBe(saved.secrets.deviceToken)
      expect(publishedHost.relayHostId).toBe(offer.relay.relayHostId)
      expect(deps.clearJournal).toHaveBeenCalledOnce()
    }
  )

  it('replaces a stale relay overlay before clearing a journal for a matching credential', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const currentRelay = {
      ...endpoints(saved, { state: 'committed', result: committed }).relay,
      cellUrl: 'https://relay-c2.onorca.dev',
      assignmentEpoch: 8
    }
    const connected = client(async () =>
      response({
        ...endpoints(saved, { state: 'committed', result: committed }),
        relay: currentRelay
      })
    )
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn(() => connected),
      bundle: {
        v: 1,
        hostId: saved.metadata.host.id,
        deviceToken: saved.secrets.deviceToken,
        current: {
          token: saved.secrets.pendingResumeToken,
          hash: saved.metadata.pendingResumeTokenHash,
          version: 1,
          expiresAt: now + 60_000
        }
      }
    })
    let publishedHost: HostProfile = {
      ...saved.metadata.host,
      deviceToken: saved.secrets.deviceToken,
      relayHostId: offer.relay.relayHostId,
      relay: endpoints(saved, { state: 'committed', result: committed }).relay,
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: offer.endpoint },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay-c1.onorca.dev' }
      ]
    }
    deps.loadHosts.mockImplementation(async () => [publishedHost])
    deps.saveExistingHostRelayUpgrade.mockImplementation(async (host) => {
      publishedHost = host
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(deps.connectRelay).toHaveBeenCalledOnce()
    expect(publishedHost.relay).toEqual(currentRelay)
    expect(deps.saveExistingHostRelayUpgrade).toHaveBeenCalledOnce()
    expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.clearJournal).toHaveBeenCalledOnce()
  })

  it('keeps edited host metadata when journal clearing fails after relay publication', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const currentRelay = {
      ...endpoints(saved, { state: 'committed', result: committed }).relay,
      cellUrl: 'https://relay-c2.onorca.dev',
      assignmentEpoch: 8
    }
    const connected = client(async () =>
      response({
        ...endpoints(saved, { state: 'committed', result: committed }),
        relay: currentRelay
      })
    )
    const unavailableInvite = client(async () => {
      throw new Error('invite unavailable')
    })
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn((args) => (args.credential ? connected : unavailableInvite)),
      bundle: {
        v: 1,
        hostId: saved.metadata.host.id,
        deviceToken: saved.secrets.deviceToken,
        current: {
          token: saved.secrets.pendingResumeToken,
          hash: saved.metadata.pendingResumeTokenHash,
          version: committed.currentVersion,
          expiresAt: now + 60_000
        }
      }
    })
    let publishedHost: HostProfile = {
      ...saved.metadata.host,
      name: 'My edited desktop',
      endpoint: 'ws://192.168.1.20:6768',
      deviceToken: saved.secrets.deviceToken,
      relayHostId: offer.relay.relayHostId,
      relay: endpoints(saved, { state: 'committed', result: committed }).relay,
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: 'ws://192.168.1.20:6768' },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay-c1.onorca.dev' }
      ]
    }
    deps.loadHosts.mockImplementation(async () => [publishedHost])
    deps.saveExistingHostRelayUpgrade.mockImplementation(async (host) => {
      publishedHost = host
    })
    deps.clearJournal.mockRejectedValueOnce(new Error('journal unavailable'))

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
    expect(publishedHost).toMatchObject({
      name: 'My edited desktop',
      endpoint: 'ws://192.168.1.20:6768',
      relay: currentRelay
    })
    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(publishedHost.name).toBe('My edited desktop')
    expect(publishedHost.endpoint).toBe('ws://192.168.1.20:6768')
    expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.saveExistingHostRelayUpgrade).toHaveBeenCalledTimes(2)
  })

  it('does not claim a newer pairing epoch while loading the existing host', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const connected = client(async () =>
      response(endpoints(saved, { state: 'committed', result: committed }))
    )
    const deps = dependencies({ journal: saved, connectRelay: vi.fn(() => connected) })
    let epoch = 1
    let releaseHostRead: () => void = () => {}
    const hostRead = new Promise<void>((resolve) => {
      releaseHostRead = resolve
    })
    deps.getHostPairingEpoch.mockImplementation(() => epoch)
    deps.loadHosts.mockImplementation(async () => {
      await hostRead
      return []
    })

    const recovery = recoverMobileRelayPairing(deps)
    await vi.waitFor(() => expect(deps.loadHosts).toHaveBeenCalledOnce())
    epoch = 2
    releaseHostRead()

    await expect(recovery).resolves.toBe('deferred')
    expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
    expect(deps.saveExistingHostRelayUpgrade).not.toHaveBeenCalled()
    expect(deps.clearJournal).not.toHaveBeenCalled()
  })

  it('preserves a rotated credential while replaying a stranded pairing journal', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const rotated: MobileRelayCredentialBundle = {
      v: 1,
      hostId: saved.metadata.host.id,
      deviceToken: saved.secrets.deviceToken,
      current: {
        token: 'R'.repeat(43),
        hash: 'S'.repeat(43),
        version: committed.currentVersion + 1,
        expiresAt: now + 120_000
      },
      grace: {
        token: saved.secrets.pendingResumeToken,
        hash: saved.metadata.pendingResumeTokenHash,
        version: committed.currentVersion,
        expiresAt: now + 60_000
      }
    }
    const expiredGrace = client(async () => {
      throw new Error('grace expired')
    })
    const connected = client(async () =>
      response(endpoints(saved, { state: 'committed', result: committed }))
    )
    const connectRelay = vi.fn((args: { credential?: string }) =>
      args.credential === saved.secrets.pendingResumeToken ? expiredGrace : connected
    )
    const deps = dependencies({
      journal: saved,
      connectRelay,
      bundle: rotated
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(connectRelay.mock.calls.map(([args]) => args.credential)).toEqual([
      saved.secrets.pendingResumeToken,
      rotated.current.token
    ])
    expect(deps.saveHostWithRelayCredential).toHaveBeenCalledOnce()
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.clearJournal).toHaveBeenCalledOnce()
  })

  it('keeps a server-confirmed current credential after two rotations past the stranded journal', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const currentToken = 'R'.repeat(43)
    let bundle: MobileRelayCredentialBundle = {
      v: 1,
      hostId: saved.metadata.host.id,
      deviceToken: saved.secrets.deviceToken,
      current: {
        token: currentToken,
        hash: hashMobileRelayCredential(currentToken),
        version: committed.currentVersion + 2,
        expiresAt: now + 120_000
      },
      grace: {
        token: 'G'.repeat(43),
        hash: hashMobileRelayCredential('G'.repeat(43)),
        version: committed.currentVersion + 1,
        expiresAt: now + 60_000
      }
    }
    const newerBundle = bundle
    const currentRelay = endpoints(saved, { state: 'committed', result: committed }).relay
    const connected = client(async () =>
      response({
        ...endpoints(saved, { state: 'committed', result: committed }),
        resumeConfirmation: {
          v: 1,
          reqId: saved.metadata.resumeConfirmReqId,
          currentVersion: bundle.current.version,
          acceptedAs: 'current',
          renewed: false,
          resumeExpiresAt: bundle.current.expiresAt
        }
      })
    )
    const rejectedPending = client(async () => {
      throw new Error('old pairing token expired')
    })
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn((args: { credential?: string }) =>
        args.credential === currentToken ? connected : rejectedPending
      ),
      bundle
    })
    let host: HostProfile = {
      ...saved.metadata.host,
      name: 'Edited after pairing',
      deviceToken: saved.secrets.deviceToken,
      relayHostId: offer.relay.relayHostId,
      relay: currentRelay,
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: offer.endpoint },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay-c1.onorca.dev' }
      ]
    }
    deps.loadHosts.mockImplementation(async () => [host])
    deps.readCredentialBundle.mockImplementation(async () => bundle)
    deps.writeCredentialBundle.mockImplementation(async (next) => {
      bundle = next
    })
    deps.saveHostWithRelayCredential.mockImplementation(async (next, writeCredential) => {
      await writeCredential()
      host = next
    })
    deps.saveExistingHostRelayUpgrade.mockImplementation(async (next) => {
      host = next
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(bundle).toEqual(newerBundle)
    expect(host.name).toBe('Edited after pairing')
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
    expect(deps.saveExistingHostRelayUpgrade).toHaveBeenCalledOnce()
    expect(deps.clearJournal).toHaveBeenCalledOnce()
  })

  it.each([
    { label: 'missing', confirmedVersion: null },
    { label: 'different', confirmedVersion: 2 },
    { label: 'mismatched hash', confirmedVersion: 3, storedHash: 'X'.repeat(43) },
    { label: 'grace', confirmedVersion: 3, acceptedAs: 'grace' as const }
  ])(
    'defers a newer bundle with $label server version evidence',
    async ({ confirmedVersion, storedHash, acceptedAs }) => {
      const saved = journal()
      const committed = installed(saved, 'authenticated-direct')
      const currentToken = 'R'.repeat(43)
      const bundle: MobileRelayCredentialBundle = {
        v: 1,
        hostId: saved.metadata.host.id,
        deviceToken: saved.secrets.deviceToken,
        current: {
          token: currentToken,
          hash: storedHash ?? hashMobileRelayCredential(currentToken),
          version: 3,
          expiresAt: now + 120_000
        }
      }
      const connected = client(async () =>
        response({
          ...endpoints(saved, { state: 'committed', result: committed }),
          ...(confirmedVersion === null
            ? {}
            : {
                resumeConfirmation: {
                  v: 1,
                  reqId: saved.metadata.resumeConfirmReqId,
                  currentVersion: confirmedVersion,
                  acceptedAs: acceptedAs ?? 'current',
                  renewed: false,
                  resumeExpiresAt: now + 120_000
                }
              })
        })
      )
      const deps = dependencies({
        journal: saved,
        connectRelay: vi.fn((args: { credential?: string }) =>
          args.credential === currentToken
            ? connected
            : client(async () => {
                throw new Error('old credential unavailable')
              })
        ),
        bundle
      })

      await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
      expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
      expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
      expect(deps.clearJournal).not.toHaveBeenCalled()
    }
  )

  it('does not mistake another device bundle for a confirmed rotation of this pairing', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const foreignBundle: MobileRelayCredentialBundle = {
      v: 1,
      hostId: saved.metadata.host.id,
      deviceToken: 'previous-device-token',
      current: {
        token: 'R'.repeat(43),
        hash: hashMobileRelayCredential('R'.repeat(43)),
        version: 3,
        expiresAt: now + 120_000
      }
    }
    const connected = client(async () =>
      response({
        ...endpoints(saved, { state: 'committed', result: committed }),
        resumeConfirmation: {
          v: 1,
          reqId: saved.metadata.resumeConfirmReqId,
          currentVersion: 3,
          acceptedAs: 'current',
          renewed: false,
          resumeExpiresAt: now + 120_000
        }
      })
    )
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn(() => connected),
      bundle: foreignBundle
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(deps.connectRelay).toHaveBeenCalledOnce()
    expect(deps.connectRelay).toHaveBeenCalledWith(
      expect.objectContaining({ credential: saved.secrets.pendingResumeToken })
    )
    expect(deps.saveExistingHostRelayUpgrade).not.toHaveBeenCalled()
    expect(deps.saveHostWithRelayCredential).toHaveBeenCalledOnce()
    expect(deps.writeCredentialBundle).toHaveBeenCalledOnce()
  })

  it('does not overwrite a newer credential published before the queued recovery callback', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const currentToken = 'R'.repeat(43)
    const newerBundle: MobileRelayCredentialBundle = {
      v: 1,
      hostId: saved.metadata.host.id,
      deviceToken: saved.secrets.deviceToken,
      current: {
        token: currentToken,
        hash: hashMobileRelayCredential(currentToken),
        version: 3,
        expiresAt: now + 120_000
      }
    }
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn(() =>
        client(async () => response(endpoints(saved, { state: 'committed', result: committed })))
      )
    })
    deps.readCredentialBundle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(newerBundle)

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
    expect(deps.saveHostWithRelayCredential).toHaveBeenCalledOnce()
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.clearJournal).not.toHaveBeenCalled()
  })

  it('leaves an already published host and credential alone while relay recovery is unavailable', async () => {
    const saved = journal()
    const matchingBundle: MobileRelayCredentialBundle = {
      v: 1,
      hostId: saved.metadata.host.id,
      deviceToken: saved.secrets.deviceToken,
      current: {
        token: saved.secrets.pendingResumeToken,
        hash: saved.metadata.pendingResumeTokenHash,
        version: 1,
        expiresAt: now + 60_000
      }
    }
    const unavailable = client(async () => {
      throw new Error('relay unavailable')
    })
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn(() => unavailable),
      bundle: matchingBundle
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
    expect(deps.saveHostWithRelayCredential).not.toHaveBeenCalled()
    expect(deps.writeCredentialBundle).not.toHaveBeenCalled()
    expect(deps.clearJournal).not.toHaveBeenCalled()
  })

  it('recovers a lost direct-install response with the pending credential first', async () => {
    const saved = journal()
    const committed = installed(saved, 'authenticated-direct')
    const pending = client(async (method, params) => {
      expect(method).toBe('pairing.getEndpoints')
      expect(params).toEqual({
        installReqId: saved.metadata.installReqId,
        resumeConfirmReqId: saved.metadata.resumeConfirmReqId
      })
      return response(endpoints(saved, { state: 'committed', result: committed }))
    })
    const connectRelay = vi.fn(() => pending)
    const deps = dependencies({ journal: saved, connectRelay })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(connectRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: saved.secrets.pendingResumeToken,
        expectedCredentialKind: 'resume'
      })
    )
    expect(deps.writeCredentialBundle).toHaveBeenCalledOnce()
    expect(deps.saveHostWithRelayCredential).toHaveBeenCalledOnce()
    expect(deps.clearJournal).toHaveBeenCalledOnce()
  })

  it('tries pending then current before an unexpired invite and transitions after not-found', async () => {
    const saved = journal()
    const currentToken = 'C'.repeat(43)
    const bundle: MobileRelayCredentialBundle = {
      v: 1,
      hostId: 'host-1',
      deviceToken: offer.deviceToken,
      current: {
        token: currentToken,
        hash: 'D'.repeat(43),
        version: 1,
        expiresAt: now + 60_000
      }
    }
    const failed = () =>
      client(async () => {
        throw new Error('resume rejected')
      })
    const relayInstalled = installed(saved, 'relay-basis')
    let statusCalls = 0
    const invite = client(async (method) => {
      if (method === 'pairing.getEndpoints') {
        statusCalls += 1
        return response(
          statusCalls === 1
            ? endpoints(saved, { state: 'not-found' })
            : endpoints(saved, { state: 'committed', result: relayInstalled })
        )
      }
      expect(saved.metadata.authorizationMode).toBe('relay-basis')
      return response(relayInstalled)
    })
    const seenCredentials: (string | undefined)[] = []
    const connectRelay = vi.fn((args) => {
      seenCredentials.push(args.credential)
      return args.credential ? failed() : invite
    })
    const deps = dependencies({ journal: saved, connectRelay, bundle })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    expect(seenCredentials).toEqual([saved.secrets.pendingResumeToken, currentToken, undefined])
    expect(deps.updateJournal).toHaveBeenCalledWith(saved.metadata.journalId, expect.any(Function))
    expect(invite.sendRequest).toHaveBeenCalledWith('pairing.provisionRelay', {
      reqId: saved.metadata.installReqId,
      newResumeTokenHash: saved.metadata.pendingResumeTokenHash
    })
  })

  it('accepts the one late direct result after invite fallback observed not-found', async () => {
    const saved = journal()
    const directInstalled = installed(saved, 'authenticated-direct')
    const failedPending = client(async () => {
      throw new Error('pending unavailable')
    })
    let statusCalls = 0
    const invite = client(async (method) => {
      if (method === 'pairing.getEndpoints') {
        statusCalls += 1
        return response(
          statusCalls === 1
            ? endpoints(saved, { state: 'not-found' })
            : endpoints(saved, { state: 'committed', result: directInstalled })
        )
      }
      return response(directInstalled)
    })
    const deps = dependencies({
      journal: saved,
      connectRelay: vi.fn((args) => (args.credential ? failedPending : invite))
    })

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('recovered')
    const written = deps.writeCredentialBundle.mock.calls[0]![0]
    expect(written.current.token).toBe(saved.secrets.pendingResumeToken)
    expect(saved.metadata.authorizationMode).toBe('authenticated-direct')
    expect(deps.updateJournal).toHaveBeenCalledTimes(2)
  })
  // Why: a journal stranded by a relay outage used to block every later pairing
  // with "recovery pending" forever, because recovery only ever deferred.
  it('abandons a journal once its invite expired and no credential can reconcile', async () => {
    const saved = journal()
    const unreachable = client(async () => {
      throw new Error('relay unreachable')
    })
    const deps = {
      ...dependencies({ journal: saved, connectRelay: vi.fn(() => unreachable) }),
      now: () => saved.metadata.relay.inviteExpiresAt + 10 * 60 * 1000 + 1
    }

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('abandoned')
    expect(deps.clearJournal).toHaveBeenCalledWith(saved.metadata.journalId)
  })

  it('keeps a just-expired journal so a brief outage cannot discard it', async () => {
    const saved = journal()
    const unreachable = client(async () => {
      throw new Error('relay unreachable')
    })
    const deps = {
      ...dependencies({ journal: saved, connectRelay: vi.fn(() => unreachable) }),
      now: () => saved.metadata.relay.inviteExpiresAt + 1
    }

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
    expect(deps.clearJournal).not.toHaveBeenCalled()
  })

  // Why: a committed install whose local persistence failed is the one case the
  // journal must survive — it is the only record left to retry the write from.
  it('keeps a journal when the server committed but the local write failed', async () => {
    const saved = journal()
    const directInstalled = installed(saved, 'authenticated-direct')
    const committed = client(async () =>
      response(endpoints(saved, { state: 'committed', result: directInstalled }))
    )
    const deps = {
      ...dependencies({ journal: saved, connectRelay: vi.fn(() => committed) }),
      now: () => saved.metadata.relay.inviteExpiresAt + 10 * 60 * 1000 + 1,
      writeCredentialBundle: vi.fn(async () => {
        throw new Error('keychain unavailable')
      })
    }

    await expect(recoverMobileRelayPairing(deps)).resolves.toBe('deferred')
    expect(deps.clearJournal).not.toHaveBeenCalled()
  })
})
