import type {
  DeviceCredentialInstalled,
  DeviceResumeConfirmed,
  MobileRelayEndpoint
} from '../../../src/shared/mobile-relay-credential-contract'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import {
  promotePairingJournalCredential,
  type MobileRelayCredentialBundle
} from './mobile-relay-credential-bundle'
import { persistRelayHost } from './mobile-endpoint-supervisor-support'
import { hashMobileRelayCredential } from './mobile-relay-credential-hash'
import { relayPairingHost } from './pairing-host-profile'
import type { HostProfile } from './types'

type RecoveryPublicationDependencies = {
  getHostPairingEpoch: (hostId: string) => number
  loadHosts: () => Promise<HostProfile[]>
  readCredentialBundle: (hostId: string) => Promise<MobileRelayCredentialBundle | null>
  writeCredentialBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>
  saveExistingHostRelayUpgrade: (host: HostProfile, pairingEpoch: number) => Promise<void>
  saveHostWithRelayCredential: (
    host: HostProfile,
    writeCredential: () => Promise<void>,
    expectedPairingEpoch?: number
  ) => Promise<void>
}

type RecoveryAuthentication = {
  credential: { kind: 'resume' | 'invite'; token: string }
  resumeConfirmation: DeviceResumeConfirmed | undefined
}

export async function publishRecoveredRelayPairing(
  journal: MobileRelayPairingJournal,
  relay: MobileRelayEndpoint,
  installed: DeviceCredentialInstalled,
  pairingEpoch: number,
  authentication: RecoveryAuthentication,
  dependencies: RecoveryPublicationDependencies
): Promise<void> {
  const hostId = journal.metadata.host.id
  if (installed.reqId !== journal.metadata.installReqId) {
    throw new Error('relay pairing install does not match recovery journal')
  }
  if (dependencies.getHostPairingEpoch(hostId) !== pairingEpoch) {
    throw new Error('relay pairing changed during recovery')
  }
  const [hosts, bundle] = await Promise.all([
    dependencies.loadHosts(),
    dependencies.readCredentialBundle(hostId)
  ])
  if (dependencies.getHostPairingEpoch(hostId) !== pairingEpoch) {
    throw new Error('relay pairing changed during recovery')
  }
  const existing = hosts.find(({ id }) => id === hostId)
  if (
    existing?.publicKeyB64 === journal.metadata.host.publicKeyB64 &&
    existing.deviceToken === journal.secrets.deviceToken &&
    keepsCurrentCredential(bundle, journal, installed, authentication)
  ) {
    await persistRelayHost(existing, relay, (host) =>
      dependencies.saveExistingHostRelayUpgrade(host, pairingEpoch)
    )
    return
  }
  rejectUnprovenNewerCredential(bundle, journal, installed, authentication)
  await dependencies.saveHostWithRelayCredential(
    relayPairingHost(journal, relay),
    async () => {
      const current = await dependencies.readCredentialBundle(hostId)
      if (keepsCurrentCredential(current, journal, installed, authentication)) {
        return
      }
      rejectUnprovenNewerCredential(current, journal, installed, authentication)
      await dependencies.writeCredentialBundle(
        promotePairingJournalCredential({ journal, installed })
      )
    },
    pairingEpoch
  )
}

function keepsCurrentCredential(
  bundle: MobileRelayCredentialBundle | null,
  journal: MobileRelayPairingJournal,
  installed: DeviceCredentialInstalled,
  authentication: RecoveryAuthentication
): boolean {
  if (containsInstalledPairingCredential(bundle, journal, installed)) {
    return true
  }
  const current = bundle?.current
  const confirmation = authentication.resumeConfirmation
  return Boolean(
    bundle?.hostId === journal.metadata.host.id &&
    bundle.deviceToken === journal.secrets.deviceToken &&
    current &&
    current.version > installed.currentVersion &&
    current.hash === hashMobileRelayCredential(current.token) &&
    authentication.credential.kind === 'resume' &&
    authentication.credential.token === current.token &&
    confirmation?.reqId === journal.metadata.resumeConfirmReqId &&
    confirmation.acceptedAs === 'current' &&
    confirmation.currentVersion === current.version
  )
}

function rejectUnprovenNewerCredential(
  bundle: MobileRelayCredentialBundle | null,
  journal: MobileRelayPairingJournal,
  installed: DeviceCredentialInstalled,
  authentication: RecoveryAuthentication
): void {
  if (
    bundle?.hostId === journal.metadata.host.id &&
    bundle.deviceToken === journal.secrets.deviceToken &&
    bundle.current.version > installed.currentVersion &&
    !keepsCurrentCredential(bundle, journal, installed, authentication)
  ) {
    throw new Error('newer relay credential cannot be verified during pairing recovery')
  }
}

function containsInstalledPairingCredential(
  bundle: MobileRelayCredentialBundle | null,
  journal: MobileRelayPairingJournal,
  installed: DeviceCredentialInstalled
): boolean {
  if (
    bundle?.hostId !== journal.metadata.host.id ||
    bundle.deviceToken !== journal.secrets.deviceToken ||
    bundle.current.version < installed.currentVersion
  ) {
    return false
  }
  const matches = (credential: MobileRelayCredentialBundle['current']) =>
    credential.token === journal.secrets.pendingResumeToken &&
    credential.hash === journal.metadata.pendingResumeTokenHash &&
    credential.version >= installed.currentVersion
  return matches(bundle.current) || (bundle.grace !== undefined && matches(bundle.grace))
}
