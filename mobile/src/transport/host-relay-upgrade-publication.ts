import { HostProfileSchema, type HostProfile } from './types'
import { readStoredHostProfilesForMutation } from './host-metadata-store'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'
import { dropSharedHostListLoad } from './host-list-load-sharing'
import { getHostPairingEpoch } from './host-pairing-epoch'

export class MobileRelayUpgradeHostRemovedError extends Error {}
export class MobileRelayUpgradeHostChangedError extends Error {}

export function runForCurrentHostPairing(
  host: HostProfile,
  expectedPairingEpoch: number,
  enqueueMutation: (operation: () => Promise<void>) => Promise<void>,
  write: () => Promise<void>
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  return enqueueMutation(async () => {
    const current = (await readStoredHostProfilesForMutation()).find(
      ({ id }) => id === validated.id
    )
    if (!current) {
      throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
    }
    if (
      current.publicKeyB64 !== validated.publicKeyB64 ||
      getHostPairingEpoch(validated.id) !== expectedPairingEpoch
    ) {
      throw new MobileRelayUpgradeHostChangedError('mobile relay upgrade host was re-paired')
    }
    await write()
  })
}

export function publishExistingHostRelayUpgrade(
  host: HostProfile,
  expectedPairingEpoch: number,
  enqueueMutation: (operation: () => Promise<void>) => Promise<void>,
  isCurrentOwner: () => boolean
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  return runForCurrentHostPairing(validated, expectedPairingEpoch, enqueueMutation, async () => {
    if (!isCurrentOwner()) {
      throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade owner stopped')
    }
    if (!validated.endpoints) {
      throw new Error('mobile relay upgrade requires endpoints')
    }
    await saveMobileRelayHostOverlay({
      v: 2,
      hostId: validated.id,
      endpoints: validated.endpoints,
      relayHostId: validated.relayHostId,
      relay: validated.relay
    })
    dropSharedHostListLoad()
  })
}
