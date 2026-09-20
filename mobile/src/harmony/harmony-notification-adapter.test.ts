import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLastNotificationResponseIfMatches } from '../../harmony/src/compat/expo-notifications'

const bridge = vi.hoisted(() => ({
  available: true,
  hasConditionalClear: true,
  clearMatching: vi.fn((_identifier: string) => true),
  clearUnconditionally: vi.fn()
}))

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  addHarmonyNativeListener: vi.fn(),
  hasHarmonyNativeModule: () => bridge.available,
  HarmonyNative: {
    get clearLastNotificationResponseIfMatches() {
      return bridge.hasConditionalClear ? bridge.clearMatching : undefined
    },
    clearLastNotificationResponse: bridge.clearUnconditionally
  }
}))

describe('Harmony notification cache adapter', () => {
  beforeEach(() => {
    bridge.available = true
    bridge.hasConditionalClear = true
    bridge.clearMatching.mockClear()
    bridge.clearUnconditionally.mockClear()
  })

  it('uses the native conditional clear result without calling the unconditional method', () => {
    bridge.clearMatching.mockReturnValueOnce(false)

    expect(clearLastNotificationResponseIfMatches('newer')).toBe(false)
    expect(bridge.clearMatching).toHaveBeenCalledExactlyOnceWith('newer')
    expect(bridge.clearUnconditionally).not.toHaveBeenCalled()
  })

  it('reports an old shell without the new method so the caller can fall back', () => {
    bridge.hasConditionalClear = false

    expect(clearLastNotificationResponseIfMatches('older')).toBeNull()
    expect(bridge.clearUnconditionally).not.toHaveBeenCalled()
  })

  it('reports an unavailable native module without attempting a clear', () => {
    bridge.available = false

    expect(clearLastNotificationResponseIfMatches('older')).toBeNull()
    expect(bridge.clearMatching).not.toHaveBeenCalled()
  })
})
