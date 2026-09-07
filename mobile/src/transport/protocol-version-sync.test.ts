import { describe, expect, it } from 'vitest'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../src/shared/protocol-version'
import { MIN_COMPATIBLE_DESKTOP_VERSION, MOBILE_PROTOCOL_VERSION } from './protocol-version'

describe('mobile and desktop protocol constants', () => {
  it('keeps the Metro-local compatibility copy synchronized with the runtime contract', () => {
    expect(MOBILE_PROTOCOL_VERSION).toBe(RUNTIME_PROTOCOL_VERSION)
    expect(MIN_COMPATIBLE_DESKTOP_VERSION).toBe(MIN_COMPATIBLE_RUNTIME_SERVER_VERSION)
  })
})
