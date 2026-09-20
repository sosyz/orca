let nextPairingEpoch = 1
const pairingEpochs = new Map<string, number>()

export function getHostPairingEpoch(hostId: string): number {
  return pairingEpochs.get(hostId) ?? 0
}

export function advanceHostPairingEpoch(hostId: string): void {
  pairingEpochs.set(hostId, nextPairingEpoch++)
}

export function resetHostPairingEpochsForTests(): void {
  pairingEpochs.clear()
  nextPairingEpoch = 1
}
