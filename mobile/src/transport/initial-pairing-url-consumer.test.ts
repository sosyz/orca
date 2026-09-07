import { describe, expect, it, vi } from 'vitest'
import { createInitialPairingUrlConsumer } from './initial-pairing-url-consumer'

describe('initial pairing URL consumer', () => {
  it('loads and delivers the launch URL once across subscriber replacement', async () => {
    let resolveInitialUrl: (url: string | null) => void = () => {}
    const loadInitialUrl = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveInitialUrl = resolve
        })
    )
    const consumeInitialUrl = createInitialPairingUrlConsumer(loadInitialUrl)
    const staleSubscriber = vi.fn()
    const activeSubscriber = vi.fn()

    consumeInitialUrl(staleSubscriber)()
    consumeInitialUrl(activeSubscriber)
    await Promise.resolve()
    resolveInitialUrl('orca://pair?code=example')
    await Promise.resolve()
    await Promise.resolve()

    expect(loadInitialUrl).toHaveBeenCalledTimes(1)
    expect(staleSubscriber).not.toHaveBeenCalled()
    expect(activeSubscriber).toHaveBeenCalledOnce()

    const laterSubscriber = vi.fn()
    consumeInitialUrl(laterSubscriber)
    await Promise.resolve()
    expect(laterSubscriber).not.toHaveBeenCalled()
  })

  it('settles loader failures without delivering a URL or retrying', async () => {
    const loadInitialUrl = vi.fn().mockRejectedValue(new Error('unavailable'))
    const consumeInitialUrl = createInitialPairingUrlConsumer(loadInitialUrl)
    const subscriber = vi.fn()

    consumeInitialUrl(subscriber)
    await Promise.resolve()
    await Promise.resolve()
    consumeInitialUrl(subscriber)
    await Promise.resolve()

    expect(loadInitialUrl).toHaveBeenCalledTimes(1)
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('settles synchronous loader failures without escaping the subscription call', async () => {
    const loadInitialUrl = vi.fn(() => {
      throw new Error('native module unavailable')
    })
    const consumeInitialUrl = createInitialPairingUrlConsumer(loadInitialUrl)
    const subscriber = vi.fn()

    expect(() => consumeInitialUrl(subscriber)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(loadInitialUrl).toHaveBeenCalledOnce()
    expect(subscriber).not.toHaveBeenCalled()
  })
})
