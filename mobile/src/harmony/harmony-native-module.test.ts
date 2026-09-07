import { describe, expect, it, vi } from 'vitest'
import {
  HarmonyNative,
  hasHarmonyNativeModule
} from '../../harmony/src/native/harmony-native-module'

const bridge = vi.hoisted(() => ({ reads: 0 }))

vi.mock('react-native', () => {
  const nativeModules = {}
  Object.defineProperty(nativeModules, 'OrcaHarmony', {
    get() {
      bridge.reads += 1
      throw new Error('unknown native module')
    }
  })
  return {
    DeviceEventEmitter: { addListener: vi.fn() },
    NativeModules: nativeModules
  }
})

vi.mock('../../harmony/node_modules/react-native/index.js', () => {
  const nativeModules = {}
  Object.defineProperty(nativeModules, 'OrcaHarmony', {
    get() {
      bridge.reads += 1
      throw new Error('unknown native module')
    }
  })
  return {
    DeviceEventEmitter: { addListener: vi.fn() },
    NativeModules: nativeModules
  }
})

vi.mock('../../harmony/src/native/NativeOrcaHarmony', () => ({ default: null }))

describe('Harmony native module lookup', () => {
  it('defers and contains a throwing legacy NativeModules lookup', () => {
    expect(bridge.reads).toBe(0)
    expect(hasHarmonyNativeModule()).toBe(false)
    expect(bridge.reads).toBe(1)
    expect(hasHarmonyNativeModule()).toBe(false)
    expect(bridge.reads).toBe(1)
    expect(() => HarmonyNative.randomBytes(1)).toThrow('OrcaHarmony native module is unavailable')
  })
})
