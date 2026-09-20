import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireMobileNativeChatTerminalWrite,
  captureMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite,
  retainMobileNativeChatTerminalStop,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'

describe('mobile-native-chat-terminal-write-lock', () => {
  afterEach(resetMobileNativeChatTerminalWritesForTests)

  it('allows composed writes on different terminals to proceed concurrently', () => {
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(true)

    expect(acquireMobileNativeChatTerminalWrite('terminal-b')).toBe(true)
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(false)

    releaseMobileNativeChatTerminalWrite('terminal-a')
    releaseMobileNativeChatTerminalWrite('terminal-b')
  })

  it('retains a cancelled composer until every Stop claim settles without cancelling the next owner', () => {
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(true)
    const original = captureMobileNativeChatTerminalWrite('terminal-a')
    const firstStop = retainMobileNativeChatTerminalStop('terminal-a')
    const secondStop = retainMobileNativeChatTerminalStop('terminal-a')
    expect(original?.cancelled).toBe(true)

    releaseMobileNativeChatTerminalWrite('terminal-a')
    firstStop()
    firstStop()
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(false)
    secondStop()
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(true)
    expect(captureMobileNativeChatTerminalWrite('terminal-a')?.cancelled).toBe(false)

    firstStop()
    secondStop()
    expect(acquireMobileNativeChatTerminalWrite('terminal-a')).toBe(false)
    expect(captureMobileNativeChatTerminalWrite('terminal-a')?.cancelled).toBe(false)
  })
})
