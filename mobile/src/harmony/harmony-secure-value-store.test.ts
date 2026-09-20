import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type SecureValueStore = {
  delete(key: string): Promise<void>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value))
}

function encryptedPayload(value: Uint8Array | string): Buffer {
  return Buffer.concat([Buffer.from(value), Buffer.alloc(16, 2)])
}

function encodedEnvelope(version: 'v2' | 'v3' = 'v3', value = 'device-token'): string {
  const nonce = Buffer.alloc(12, 1).toString('base64')
  const encrypted = encryptedPayload(value).toString('base64')
  return `${version}.${nonce}.${encrypted}`
}

function setupSecureStore(options?: {
  additionalValues?: Record<string, string>
  decryptGate?: Promise<void>
  decryptGates?: Array<Promise<void> | undefined>
  finishError?: Error & { code?: number }
  flushGates?: Array<Promise<void> | undefined>
  flushFailures?: Error[]
  getAllError?: Error
  getGates?: Array<Promise<void> | undefined>
  hasKey?: (alias: string) => boolean | Promise<boolean>
  putFailures?: Array<Error | null>
  stored?: string
}) {
  const values = new Map<string, string>([
    ['pairing:token', options?.stored ?? encodedEnvelope()],
    ...Object.entries(options?.additionalValues ?? {})
  ])
  const durableValues = new Map(values)
  let modified = false
  const store = {
    delete: vi.fn(async (key: string) => {
      if (values.delete(key)) {
        modified = true
      }
    }),
    flush: vi.fn(async () => {
      const hadChanges = modified
      modified = false
      const gate = options?.flushGates?.shift()
      if (gate) {
        await gate
      }
      const error = options?.flushFailures?.shift()
      if (error) {
        throw error
      }
      if (hadChanges) {
        durableValues.clear()
        values.forEach((value, key) => durableValues.set(key, value))
      }
    }),
    get: vi.fn(async (key: string, fallback: string) => {
      const gate = options?.getGates?.shift()
      if (gate) {
        await gate
      }
      return values.get(key) ?? fallback
    }),
    getAll: vi.fn(async () => {
      if (options?.getAllError) {
        throw options.getAllError
      }
      return Object.fromEntries(values)
    }),
    has: vi.fn(async (key: string) => values.has(key)),
    put: vi.fn(async (key: string, value: string) => {
      const error = options?.putFailures?.shift()
      if (error) {
        throw error
      }
      if (values.get(key) !== value) {
        modified = true
      }
      values.set(key, value)
    })
  }
  const generatedAliases = new Set<string>()
  let decryptCalls = 0
  const huks = {
    HuksAuthStorageLevel: {
      HUKS_AUTH_STORAGE_LEVEL_CE: 20,
      HUKS_AUTH_STORAGE_LEVEL_DE: 10,
      HUKS_AUTH_STORAGE_LEVEL_ECE: 30
    },
    HuksCipherMode: { HUKS_MODE_GCM: 5 },
    HuksKeyAlg: { HUKS_ALG_AES: 1 },
    HuksKeyPadding: { HUKS_PADDING_NONE: 4 },
    HuksKeyPurpose: { HUKS_KEY_PURPOSE_DECRYPT: 2, HUKS_KEY_PURPOSE_ENCRYPT: 1 },
    HuksKeySize: { HUKS_AES_KEY_SIZE_256: 256 },
    HuksTag: {
      HUKS_TAG_AE_TAG: 8,
      HUKS_TAG_ALGORITHM: 1,
      HUKS_TAG_ASSOCIATED_DATA: 7,
      HUKS_TAG_AUTH_STORAGE_LEVEL: 9,
      HUKS_TAG_BLOCK_MODE: 5,
      HUKS_TAG_KEY_SIZE: 2,
      HUKS_TAG_NONCE: 6,
      HUKS_TAG_PADDING: 4,
      HUKS_TAG_PURPOSE: 3
    },
    abortSession: vi.fn(async () => undefined),
    finishSession: vi.fn(
      async (
        _handle: number,
        huksOptions: { inData?: Uint8Array; properties: Array<{ tag: number; value: unknown }> }
      ) => {
        if (options?.finishError) {
          throw options.finishError
        }
        const purpose = huksOptions.properties.find(({ tag }) => tag === 3)?.value
        if (purpose === 1) {
          return {
            outData: Uint8Array.from(encryptedPayload(huksOptions.inData ?? new Uint8Array()))
          }
        }
        const gate =
          options?.decryptGates?.[decryptCalls] ??
          (decryptCalls === 0 ? options?.decryptGate : undefined)
        decryptCalls += 1
        if (gate) {
          await gate
        }
        return { outData: huksOptions.inData ?? bytes('device-token') }
      }
    ),
    generateKeyItem: vi.fn(async (alias: string) => {
      generatedAliases.add(alias)
    }),
    hasKeyItem: vi.fn(async (alias: string) =>
      generatedAliases.has(alias) ? true : (options?.hasKey?.(alias) ?? true)
    ),
    initSession: vi.fn(async () => ({ handle: 7 }))
  }
  const hilog = { error: vi.fn() }
  const { SecureValueStore } = loadHarmonyNativeService<{
    SecureValueStore: new (context: object) => SecureValueStore
  }>('SecureValueStore.ets', {
    '@kit.ArkData': { preferences: { getPreferences: vi.fn(async () => store) } },
    '@kit.ArkTS': {
      buffer: Buffer,
      util: {
        Base64Helper: class {
          decodeSync(value: string) {
            return Uint8Array.from(Buffer.from(value, 'base64'))
          }
          encodeToStringSync(value: Uint8Array) {
            return Buffer.from(value).toString('base64')
          }
        }
      }
    },
    '@kit.CryptoArchitectureKit': {
      cryptoFramework: {
        createRandom: () => ({ generateRandomSync: () => ({ data: new Uint8Array(12) }) })
      }
    },
    '@kit.PerformanceAnalysisKit': { hilog },
    '@kit.UniversalKeystoreKit': { huks }
  })
  return {
    createService: () => new SecureValueStore({}),
    hilog,
    huks,
    service: new SecureValueStore({}),
    durableValues,
    store,
    values
  }
}

describe('Harmony SecureValueStore', () => {
  it('does not generate or overwrite keys while reading a v3 envelope', async () => {
    const { hilog, huks, service, store } = setupSecureStore({
      hasKey: (alias) => !alias.endsWith('.v3')
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: HUKS key is unavailable'
    )

    expect(huks.generateKeyItem).not.toHaveBeenCalled()
    expect(huks.initSession).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(store.flush).not.toHaveBeenCalled()
    expect(hilog.error).toHaveBeenCalledWith(
      0x0a11,
      'OrcaSecureStore',
      'huks operation=%{public}s code=%{public}d',
      'read-key-missing',
      0
    )
  })

  it('logs only the HUKS operation and numeric code when decrypt fails', async () => {
    const finishError = Object.assign(new Error('do not log this message'), { code: 123456 })
    const { hilog, huks, service } = setupSecureStore({ finishError })

    await expect(service.get('pairing:token')).rejects.toThrow('Secure storage read failed')

    expect(huks.abortSession).toHaveBeenCalledWith(7, expect.anything())
    const flattenedLog = hilog.error.mock.calls.flat().map(String).join('\n')
    expect(flattenedLog).toContain('read-v3-decrypt-finish')
    expect(flattenedLog).toContain('123456')
    expect(flattenedLog).toContain('key-presence')
    expect(flattenedLog).toContain('ECE')
    expect(flattenedLog).toContain('CE')
    expect(flattenedLog).toContain('DE')
    expect(flattenedLog).toContain('DEFAULT')
    expect(flattenedLog).not.toContain('pairing:token')
    expect(flattenedLog).not.toContain('device-token')
    expect(flattenedLog).not.toContain('do not log this message')
  })

  it('runs key-presence diagnostics at most once per store and preserves the original error', async () => {
    const finishError = Object.assign(new Error('first decrypt failed'), { code: 12000006 })
    const presenceError = Object.assign(new Error('presence failed'), { code: 12000005 })
    const { hilog, huks, service, store } = setupSecureStore({
      finishError,
      hasKey: (alias) => {
        if (alias.endsWith('.v2')) {
          throw presenceError
        }
        return true
      }
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed (12000006): first decrypt failed'
    )
    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed (12000006): first decrypt failed'
    )

    const keyPresenceLogs = hilog.error.mock.calls.filter((call) =>
      String(call[2]).includes('key-presence')
    )
    expect(keyPresenceLogs).toHaveLength(4)
    expect(keyPresenceLogs.at(-1)).toEqual([
      0x0a11,
      'OrcaSecureStore',
      'huks key-presence alias=%{public}s storage=%{public}s exists=%{public}s code=%{public}d',
      'v2',
      'DEFAULT',
      'unknown',
      12000005
    ])
    expect(store.put).not.toHaveBeenCalled()
    expect(store.flush).not.toHaveBeenCalled()
    expect(huks.generateKeyItem).not.toHaveBeenCalled()
  })

  it('migrates a readable legacy envelope to v3 ECE before returning the value', async () => {
    const { huks, service, values } = setupSecureStore({
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).resolves.toBe('device-token')

    expect(huks.generateKeyItem).toHaveBeenCalledOnce()
    expect(values.get('pairing:token')).toMatch(/^v3\./u)
  })

  it('does not regenerate a missing v3 key when any v3 envelope is already retained', async () => {
    const { huks, service, store, values } = setupSecureStore({
      additionalValues: { 'other:key': encodedEnvelope('v3', 'other-token') },
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: HUKS key is unavailable while v3 secure values exist'
    )

    expect(huks.generateKeyItem).not.toHaveBeenCalled()
    expect(values.get('pairing:token')).toBe(encodedEnvelope('v2'))
    expect(store.put).not.toHaveBeenCalled()
  })

  it('does not generate a replacement v3 key when scanning existing prefs fails', async () => {
    const { huks, service, values } = setupSecureStore({
      getAllError: new Error('prefs scan failed'),
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: prefs scan failed'
    )

    expect(huks.generateKeyItem).not.toHaveBeenCalled()
    expect(values.get('pairing:token')).toBe(encodedEnvelope('v2'))
  })

  it('does not generate a missing v3 key for a new set when any v3 envelope is retained', async () => {
    const { huks, service, store, values } = setupSecureStore({
      additionalValues: { 'other:key': encodedEnvelope('v3', 'other-token') },
      hasKey: (alias) => !alias.endsWith('.v3')
    })

    await expect(service.set('fresh:key', 'fresh-token')).rejects.toThrow(
      'Secure storage write failed: HUKS key is unavailable while v3 secure values exist'
    )

    expect(huks.generateKeyItem).not.toHaveBeenCalled()
    expect(values.has('fresh:key')).toBe(false)
    expect(store.put).not.toHaveBeenCalled()
  })

  it('fails closed on a preferences scan error before a new set can generate a key', async () => {
    const { huks, service, store, values } = setupSecureStore({
      getAllError: new Error('prefs scan failed'),
      hasKey: (alias) => !alias.endsWith('.v3')
    })

    await expect(service.set('fresh:key', 'fresh-token')).rejects.toThrow(
      'Secure storage write failed: prefs scan failed'
    )

    expect(huks.generateKeyItem).not.toHaveBeenCalled()
    expect(values.has('fresh:key')).toBe(false)
    expect(store.put).not.toHaveBeenCalled()
  })

  it('rolls back a failed legacy migration flush and does not mask the flush error', async () => {
    const { durableValues, huks, service, values } = setupSecureStore({
      flushFailures: [new Error('migration flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: migration flush failed'
    )

    expect(huks.generateKeyItem).toHaveBeenCalledOnce()
    expect(values.get('pairing:token')).toBe(encodedEnvelope('v2'))
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope('v2'))
    await expect(service.get('pairing:token')).resolves.toBe('device-token')
    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toMatch(/^v3\./u)
  })

  it('fails closed when legacy migration rollback cannot restore the cached value', async () => {
    const { durableValues, service, store, values } = setupSecureStore({
      flushFailures: [new Error('migration flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      putFailures: [null, new Error('rollback put failed')],
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: migration flush failed'
    )

    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope('v2'))
    const getCalls = store.get.mock.calls.length
    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: migration flush failed'
    )
    expect(store.get).toHaveBeenCalledTimes(getCalls)
  })

  it('fails closed for a queued legacy read after rollback leaves cached v3 uncertain', async () => {
    const gate = deferred<void>()
    const { durableValues, huks, service, store, values } = setupSecureStore({
      decryptGate: gate.promise,
      flushFailures: [new Error('migration flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      putFailures: [null, new Error('rollback put failed')],
      stored: encodedEnvelope('v2', 'old-token')
    })

    const firstRead = service.get('pairing:token')
    await vi.waitFor(() => expect(huks.finishSession).toHaveBeenCalledOnce())
    const secondRead = service.get('pairing:token')

    gate.resolve()
    await expect(firstRead).rejects.toThrow('Secure storage read failed: migration flush failed')
    await expect(secondRead).rejects.toThrow('Secure storage read failed: migration flush failed')

    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope('v2', 'old-token'))
    expect(store.get).toHaveBeenCalledTimes(3)
  })

  it('allows an uncertain migration after a later flush persists the whole preferences instance', async () => {
    const { durableValues, service, values } = setupSecureStore({
      flushFailures: [new Error('migration flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      putFailures: [null, new Error('rollback put failed')],
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow('migration flush failed')
    await service.set('other:key', 'other-token')

    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toMatch(/^v3\./u)
    await expect(service.get('pairing:token')).resolves.toBe('device-token')
  })

  it('keeps uncertainty after a no-op delete flush', async () => {
    const { durableValues, service, store, values } = setupSecureStore({
      flushFailures: [new Error('migration flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      putFailures: [null, new Error('rollback put failed')],
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow('migration flush failed')
    await expect(service.delete('missing:key')).rejects.toThrow(
      'Secure storage delete failed: migration flush failed'
    )

    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope('v2'))
    expect(store.flush).toHaveBeenCalledOnce()
    await expect(service.get('pairing:token')).rejects.toThrow('migration flush failed')
  })

  it('allows a missing-key delete when durability is confirmed', async () => {
    const { service, store } = setupSecureStore()

    await expect(service.delete('missing:key')).resolves.toBeUndefined()

    expect(store.delete).not.toHaveBeenCalled()
    expect(store.flush).not.toHaveBeenCalled()
  })

  it('does not let a v3 get observe a held set before its flush completes', async () => {
    const getGate = deferred<void>()
    const flushGate = deferred<void>()
    const { service, store } = setupSecureStore({
      flushGates: [flushGate.promise],
      getGates: [getGate.promise],
      stored: encodedEnvelope('v3', 'old-token')
    })

    const firstRead = service.get('pairing:token')
    await vi.waitFor(() => expect(store.get).toHaveBeenCalledOnce())
    const write = service.set('pairing:token', 'new-token')

    await Promise.resolve()
    expect(store.put).not.toHaveBeenCalled()

    getGate.resolve()
    await expect(firstRead).resolves.toBe('old-token')
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledOnce())

    const secondRead = service.get('pairing:token')
    await Promise.resolve()
    expect(store.get).toHaveBeenCalledTimes(2)

    flushGate.resolve()
    await expect(write).resolves.toBeUndefined()
    await expect(secondRead).resolves.toBe('new-token')
    expect(store.get).toHaveBeenCalledTimes(3)
  })

  it('does not return a set value until a later preferences flush succeeds', async () => {
    const { durableValues, service, store, values } = setupSecureStore({
      flushFailures: [new Error('set flush failed')]
    })

    await expect(service.set('pairing:token', 'new-token')).rejects.toThrow(
      'Secure storage write failed: set flush failed'
    )

    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope())
    await expect(service.set('pairing:token', 'new-token')).rejects.toThrow(
      'Secure storage write failed: set flush failed'
    )
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope())
    const getCalls = store.get.mock.calls.length
    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: set flush failed'
    )
    expect(store.get).toHaveBeenCalledTimes(getCalls)

    await service.set('pairing:token', 'durable-token')
    await expect(service.get('pairing:token')).resolves.toBe('durable-token')
  })

  it('keeps a failed flush uncertain across native module recreation', async () => {
    const { createService, durableValues, service, store } = setupSecureStore({
      flushFailures: [new Error('set flush failed')]
    })

    await expect(service.set('pairing:token', 'new-token')).rejects.toThrow('set flush failed')
    const replacement = createService()
    const readsBefore = store.get.mock.calls.length
    await expect(replacement.get('pairing:token')).rejects.toThrow('set flush failed')
    expect(store.get).toHaveBeenCalledTimes(readsBefore)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope())

    await replacement.set('other:key', 'durable-token')
    await expect(replacement.get('pairing:token')).resolves.toBe('new-token')
    expect(durableValues.get('pairing:token')).toMatch(/^v3\./u)
  })

  it('waits for the previous native module flush before reading from its replacement', async () => {
    const flushGate = deferred<void>()
    const { createService, service, store } = setupSecureStore({
      flushGates: [flushGate.promise]
    })

    const write = service.set('pairing:token', 'new-token')
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledOnce())
    const readsBefore = store.get.mock.calls.length
    const read = createService().get('pairing:token')
    await Promise.resolve()
    expect(store.get).toHaveBeenCalledTimes(readsBefore)

    flushGate.resolve()
    await expect(write).resolves.toBeUndefined()
    await expect(read).resolves.toBe('new-token')
  })

  it('does not return a deleted value until a later preferences flush succeeds', async () => {
    const { durableValues, service, store, values } = setupSecureStore({
      flushFailures: [new Error('delete flush failed')]
    })

    await expect(service.delete('pairing:token')).rejects.toThrow(
      'Secure storage delete failed: delete flush failed'
    )

    expect(values.has('pairing:token')).toBe(false)
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope())
    await expect(service.delete('pairing:token')).rejects.toThrow(
      'Secure storage delete failed: delete flush failed'
    )
    expect(durableValues.get('pairing:token')).toBe(encodedEnvelope())
    const getCalls = store.get.mock.calls.length
    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: delete flush failed'
    )
    expect(store.get).toHaveBeenCalledTimes(getCalls)

    await service.set('pairing:token', 'durable-token')
    await expect(service.get('pairing:token')).resolves.toBe('durable-token')
  })

  it('continues serving queued operations after a get fails', async () => {
    const { service, values } = setupSecureStore({ stored: 'not-an-envelope' })

    await expect(service.get('pairing:token')).rejects.toThrow(
      'Secure storage read failed: Secure value has an invalid envelope'
    )
    await service.set('fresh:key', 'fresh-token')

    expect(values.get('fresh:key')).toMatch(/^v3\./u)
    await expect(service.get('fresh:key')).resolves.toBe('fresh-token')
  })

  it('continues serving queued writes after a migration write fails', async () => {
    const { service, values } = setupSecureStore({
      flushFailures: [new Error('first flush failed')],
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    await expect(service.get('pairing:token')).rejects.toThrow('first flush failed')
    await service.set('fresh:key', 'fresh-token')

    expect(values.get('pairing:token')).toBe(encodedEnvelope('v2'))
    expect(values.get('fresh:key')).toMatch(/^v3\./u)
  })

  it('applies a queued set after an in-flight legacy get migrates', async () => {
    const gate = deferred<void>()
    const { huks, service, values } = setupSecureStore({
      decryptGate: gate.promise,
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2', 'old-token')
    })

    const legacyRead = service.get('pairing:token')
    await vi.waitFor(() => expect(huks.finishSession).toHaveBeenCalledOnce())
    const queuedSet = service.set('pairing:token', 'new-token')
    gate.resolve()

    await expect(legacyRead).resolves.toBe('old-token')
    await expect(queuedSet).resolves.toBeUndefined()
    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    await expect(service.get('pairing:token')).resolves.toBe('new-token')
  })

  it('applies a queued delete after an in-flight legacy get migrates', async () => {
    const gate = deferred<void>()
    const { huks, service, values } = setupSecureStore({
      decryptGate: gate.promise,
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2')
    })

    const legacyRead = service.get('pairing:token')
    await vi.waitFor(() => expect(huks.finishSession).toHaveBeenCalledOnce())
    const queuedDelete = service.delete('pairing:token')
    gate.resolve()

    await expect(legacyRead).resolves.toBe('device-token')
    await expect(queuedDelete).resolves.toBeUndefined()
    expect(values.has('pairing:token')).toBe(false)
    await expect(service.get('pairing:token')).resolves.toBeNull()
  })

  it('serializes two concurrent legacy migrations on one store instance', async () => {
    const gate = deferred<void>()
    const { huks, service, store, values } = setupSecureStore({
      decryptGate: gate.promise,
      hasKey: (alias) => !alias.endsWith('.v3'),
      stored: encodedEnvelope('v2', 'old-token')
    })

    const firstRead = service.get('pairing:token')
    await vi.waitFor(() => expect(huks.finishSession).toHaveBeenCalledOnce())
    const secondRead = service.get('pairing:token')
    gate.resolve()

    await expect(firstRead).resolves.toBe('old-token')
    await expect(secondRead).resolves.toBe('old-token')
    expect(values.get('pairing:token')).toMatch(/^v3\./u)
    expect(store.put).toHaveBeenCalledOnce()
    expect(store.flush).toHaveBeenCalledOnce()
  })
})
