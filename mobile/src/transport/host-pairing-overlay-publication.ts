import type { HostProfile } from './types'
import { readStoredHostProfilesForMutation } from './host-metadata-store'
import {
  removeMobileRelayHostOverlays,
  saveMobileRelayHostOverlay
} from './mobile-relay-host-overlay-store'
import { dropSharedHostListLoad } from './host-list-load-sharing'

export async function publishHostPairingOverlay(
  host: HostProfile,
  duplicateHostIds: ReadonlySet<string>
): Promise<void> {
  const storedIds = new Set((await readStoredHostProfilesForMutation()).map(({ id }) => id))
  if (storedIds.has(host.id) && host.endpoints) {
    await saveMobileRelayHostOverlay({
      v: 2,
      hostId: host.id,
      endpoints: host.endpoints,
      relayHostId: host.relayHostId,
      relay: host.relay
    })
    dropSharedHostListLoad()
  }
  const overlayRemovalIds = [...duplicateHostIds].filter((id) => !storedIds.has(id))
  if (!host.endpoints && storedIds.has(host.id)) {
    overlayRemovalIds.push(host.id)
  }
  if (overlayRemovalIds.length > 0) {
    await removeMobileRelayHostOverlays(overlayRemovalIds)
    dropSharedHostListLoad()
  }
}
