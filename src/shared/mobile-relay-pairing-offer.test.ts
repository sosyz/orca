import { describe, expect, it } from 'vitest'
import { createPairingOfferSchema } from './mobile-relay-pairing-offer'
import { createMobileRelayPairingFixtures } from './mobile-relay-pairing-fixtures'

describe('desktop mobile-relay pairing contract', () => {
  const now = Date.UTC(2026, 6, 12, 16)
  const schema = createPairingOfferSchema(() => now)

  for (const fixture of createMobileRelayPairingFixtures(now)) {
    it(fixture.name, () => {
      const result = schema.safeParse(fixture.payload)
      expect(result.success ? result.data : null).toEqual(fixture.expected)
    })
  }

  it('preserves optional paired device identity', () => {
    const fixture = createMobileRelayPairingFixtures(now)[0]!
    if (!fixture.expected) {
      throw new Error('Expected a valid direct pairing fixture')
    }
    const payload = { ...fixture.expected, pairedDeviceId: 'paired-device-a' }

    expect(schema.parse(payload)).toMatchObject({ pairedDeviceId: 'paired-device-a' })
  })

  it.each([
    'http://desktop.example:6768',
    'file:///tmp/orca-runtime',
    'ws://user:password@desktop.example:6768',
    'wss://desktop.example:6768/runtime#fragment',
    'wss://desktop.example:6768/runtime?accessToken=secret',
    'wss://desktop.example:6768/runtime?refresh_token=secret',
    'wss://desktop.example:6768/runtime?apiKey=secret',
    'wss://desktop.example:6768/runtime?password=secret',
    'wss://desktop.example:6768/runtime?client_secret=secret'
  ])('rejects unsafe endpoint %s', (endpoint) => {
    const fixture = createMobileRelayPairingFixtures(now)[0]!
    const payload = schema.parse(fixture.payload)
    expect(schema.safeParse({ ...payload, endpoint }).success).toBe(false)
  })

  it('allows non-sensitive routing query parameters', () => {
    const fixture = createMobileRelayPairingFixtures(now)[0]!
    const payload = schema.parse(fixture.payload)
    expect(
      schema.safeParse({
        ...payload,
        endpoint: 'wss://desktop.example/runtime?route=private'
      }).success
    ).toBe(true)
  })
})
