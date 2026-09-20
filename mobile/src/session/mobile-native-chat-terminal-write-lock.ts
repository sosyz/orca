// Serializes composed native-chat write sequences (clear/paste/settle/submit,
// paced answer keystrokes) per HOST terminal. Two concurrent sequences into one
// PTY interleave their bytes; a second sender must be rejected up front, not
// woven in. Module scope for the same reason as the stale-input marker: the
// terminal outlives any one screen, and independent hooks share the same PTY.
type TerminalWriteOwner = { cancelled: boolean; claims: number }
const writeInFlightTerminals = new Map<string, TerminalWriteOwner>()

export function captureMobileNativeChatTerminalWrite(
  terminal: string
): Readonly<Pick<TerminalWriteOwner, 'cancelled'>> | undefined {
  return writeInFlightTerminals.get(terminal)
}

function releaseOwner(terminal: string, owner: TerminalWriteOwner): void {
  if (writeInFlightTerminals.get(terminal) !== owner) {
    return
  }
  owner.claims -= 1
  if (owner.claims === 0) {
    writeInFlightTerminals.delete(terminal)
  }
}

/** Stop retains the same owner until its delayed Escape and in-flight writes settle. */
export function retainMobileNativeChatTerminalStop(terminal: string): () => void {
  const owner = writeInFlightTerminals.get(terminal) ?? { cancelled: false, claims: 0 }
  owner.cancelled = true
  owner.claims += 1
  writeInFlightTerminals.set(terminal, owner)
  let released = false
  return () => {
    if (!released) {
      released = true
      releaseOwner(terminal, owner)
    }
  }
}

/** Claim the terminal for one composed write sequence. False = another
 *  sequence is mid-flight; the caller must reject its send. */
export function acquireMobileNativeChatTerminalWrite(terminal: string): boolean {
  if (writeInFlightTerminals.has(terminal)) {
    return false
  }
  writeInFlightTerminals.set(terminal, { cancelled: false, claims: 1 })
  return true
}

export function releaseMobileNativeChatTerminalWrite(terminal: string): void {
  const owner = writeInFlightTerminals.get(terminal)
  if (owner) {
    releaseOwner(terminal, owner)
  }
}

/** Test-only: module scope outlives a single test's hooks. */
export function resetMobileNativeChatTerminalWritesForTests(): void {
  writeInFlightTerminals.clear()
}
