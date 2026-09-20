import { Platform } from 'react-native'
import { HostProfileSchema, type HostProfile, type StoredHostProfile } from './types'
import { advanceHostPairingEpoch, getHostPairingEpoch } from './host-pairing-epoch'
import { MobileRelayUpgradeHostChangedError } from './host-relay-upgrade-publication'
import { toStoredHostProfile } from './host-metadata-store'
import { recordHostCredentialCleanupIntent } from './host-credential-cleanup'
import { publishHostPairingOverlay } from './host-pairing-overlay-publication'
import {
  deleteMobileRelayDirectUpgradeJournal,
  readMobileRelayDirectUpgradeJournal
} from './mobile-relay-direct-upgrade-journal'

type PublicationDependencies = {
  mutateStoredHosts: (
    update: (hosts: StoredHostProfile[]) => Promise<StoredHostProfile[]>,
    afterWrite: () => Promise<void>
  ) => Promise<void>
  commitDeviceToken: (hostId: string, token: string) => Promise<void>
  cancelCleanupForDurablyStoredHosts: (hostIds: Iterable<string>) => Promise<void>
  scheduleUnpairedHostCredentialCleanup: (hostId: string) => Promise<void>
  cancelCleanupForStoredHost: (hostId: string) => void
}

export async function persistHostPairing(
  host: HostProfile,
  writeCredential: (() => Promise<void>) | undefined,
  dependencies: PublicationDependencies,
  expectedPairingEpoch?: number
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  if (writeCredential && !validated.endpoints) {
    throw new Error('relay pairing publication requires endpoints')
  }
  const stored = toStoredHostProfile(validated)
  const duplicateHostIds = new Set<string>()
  let metadataCommitted = false
  let cleanupIntentRecordedBeforeMetadata = false
  let tokenCommittedBeforeMetadata = false
  try {
    await dependencies.mutateStoredHosts(
      async (hosts) => {
        if (
          expectedPairingEpoch !== undefined &&
          getHostPairingEpoch(stored.id) !== expectedPairingEpoch
        ) {
          throw new MobileRelayUpgradeHostChangedError(
            'mobile relay pairing changed during recovery'
          )
        }
        advanceHostPairingEpoch(stored.id)
        if (Platform.OS !== 'web' && (await readMobileRelayDirectUpgradeJournal(stored.id))) {
          await deleteMobileRelayDirectUpgradeJournal(stored.id)
        }
        if (writeCredential) {
          await writeCredential()
        }
        const index = hosts.findIndex((h) => h.id === stored.id)
        for (const candidate of hosts) {
          if (candidate.id !== stored.id && candidate.publicKeyB64 === stored.publicKeyB64) {
            duplicateHostIds.add(candidate.id)
          }
        }
        let next: StoredHostProfile[]
        if (index !== -1) {
          // Why: an authoritative save is the safe point to collapse pre-existing duplicate rows to the preserved host id.
          next = hosts
            .filter(({ id }) => !duplicateHostIds.has(id))
            .map((candidate) => (candidate.id === stored.id ? stored : candidate))
        } else {
          next = [...hosts.filter(({ id }) => !duplicateHostIds.has(id)), stored]
        }
        if (duplicateHostIds.size > 0) {
          if (index === -1) {
            // Why: process death between the early token write and metadata publication must leave cleanup discoverable.
            await recordHostCredentialCleanupIntent(stored.id)
            cleanupIntentRecordedBeforeMetadata = true
          }
          for (const duplicateHostId of duplicateHostIds) {
            await recordHostCredentialCleanupIntent(duplicateHostId)
          }
          // Why: never remove the only usable same-key row until its replacement credential is durable.
          await dependencies.commitDeviceToken(stored.id, validated.deviceToken)
          tokenCommittedBeforeMetadata = true
        }
        return next
      },
      async () => {
        metadataCommitted = true
        if (!tokenCommittedBeforeMetadata) {
          // Keep metadata recoverable if the credential write fails.
          await dependencies.commitDeviceToken(stored.id, validated.deviceToken)
        }
        await publishHostPairingOverlay(validated, duplicateHostIds)
      }
    )
  } catch (error) {
    if (!metadataCommitted) {
      await dependencies.cancelCleanupForDurablyStoredHosts(duplicateHostIds)
      if (cleanupIntentRecordedBeforeMetadata) {
        try {
          await dependencies.scheduleUnpairedHostCredentialCleanup(stored.id)
        } catch {
          // The write-ahead cleanup intent remains available for retry.
        }
      }
    }
    throw error
  }
  // Why: a later removal owns its cleanup intent; cancel only while this publication remains authoritative.
  dependencies.cancelCleanupForStoredHost(stored.id)
  for (const duplicateHostId of duplicateHostIds) {
    try {
      await dependencies.scheduleUnpairedHostCredentialCleanup(duplicateHostId)
    } catch {
      // Metadata is already deduplicated; orphan-token recovery is best-effort.
    }
  }
}
