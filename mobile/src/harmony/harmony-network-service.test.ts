import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type HarmonyNetworkState = {
  isConnected: boolean
  isInternetReachable: boolean
  type: string
}

type NetworkCapabilities = {
  bearerTypes: string[]
  networkCap?: string[]
}

type NetEventName = 'netAvailable' | 'netLost' | 'netUnavailable' | 'netCapabilitiesChange'

const NetCap = {
  NET_CAPABILITY_VALIDATED: 'validated'
} as const

const NetBearType = {
  BEARER_BLUETOOTH: 'bluetooth',
  BEARER_CELLULAR: 'cellular',
  BEARER_ETHERNET: 'ethernet',
  BEARER_VPN: 'vpn',
  BEARER_WIFI: 'wifi'
} as const

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function capabilities(bearerType: string, validated = true): NetworkCapabilities {
  return {
    bearerTypes: [bearerType],
    networkCap: validated ? [NetCap.NET_CAPABILITY_VALIDATED] : []
  }
}

function setupNetworkService() {
  const handlers = new Map<NetEventName, (payload?: { netCap: NetworkCapabilities }) => void>()
  let registeredCallback: ((error?: Error | null) => void) | null = null
  const emissions: Array<{ eventName: string; state: HarmonyNetworkState }> = []
  const netConnection = {
    on: vi.fn(
      (eventName: NetEventName, handler: (payload?: { netCap: NetworkCapabilities }) => void) => {
        handlers.set(eventName, handler)
      }
    ),
    register: vi.fn((callback: (error?: Error | null) => void) => {
      registeredCallback = callback
    }),
    unregister: vi.fn()
  }
  const getDefaultNet = vi.fn<() => Promise<string>>()
  const getNetCapabilities = vi.fn<(handle: string) => Promise<NetworkCapabilities>>()
  const { HarmonyNetworkService } = loadHarmonyNativeService<{
    HarmonyNetworkService: new (emit: (eventName: string, payload: object) => void) => {
      destroy(): void
      getState(): Promise<HarmonyNetworkState>
    }
  }>('HarmonyNetworkService.ets', {
    '@kit.NetworkKit': {
      connection: {
        createNetConnection: () => netConnection,
        getDefaultNet,
        getNetCapabilities,
        NetBearType,
        NetCap
      }
    }
  })
  const service = new HarmonyNetworkService((eventName, payload) => {
    emissions.push({ eventName, state: payload as HarmonyNetworkState })
  })
  function emitNative(eventName: NetEventName, payload?: { netCap: NetworkCapabilities }): void {
    const handler = handlers.get(eventName)
    expect(handler).toBeDefined()
    handler?.(payload)
  }
  return {
    emitNative,
    emissions,
    getDefaultNet,
    getNetCapabilities,
    netConnection,
    registeredCallback,
    service
  }
}

describe('HarmonyNetworkService', () => {
  it('does not let an older async snapshot overwrite a newer lost-network observation', async () => {
    const setup = setupNetworkService()
    const oldDefaultNet = deferred<string>()
    const oldCapabilities = deferred<NetworkCapabilities>()
    setup.getDefaultNet
      .mockReturnValueOnce(oldDefaultNet.promise)
      .mockRejectedValueOnce(new Error('no replacement network'))
    setup.getNetCapabilities.mockReturnValueOnce(oldCapabilities.promise)

    setup.emitNative('netAvailable')
    setup.emitNative('netLost')
    expect(setup.emissions).toEqual([
      {
        eventName: 'OrcaHarmonyNetworkChange',
        state: { isConnected: false, isInternetReachable: false, type: 'NONE' }
      }
    ])

    oldDefaultNet.resolve('old-wifi')
    await flushPromises()
    oldCapabilities.resolve(capabilities(NetBearType.BEARER_WIFI))
    await flushPromises()

    expect(setup.emissions).toEqual([
      {
        eventName: 'OrcaHarmonyNetworkChange',
        state: { isConnected: false, isInternetReachable: false, type: 'NONE' }
      }
    ])
  })

  it('publishes only the latest pending async snapshot', async () => {
    const setup = setupNetworkService()
    const firstDefaultNet = deferred<string>()
    const firstCapabilities = deferred<NetworkCapabilities>()
    const secondDefaultNet = deferred<string>()
    const secondCapabilities = deferred<NetworkCapabilities>()
    setup.getDefaultNet
      .mockReturnValueOnce(firstDefaultNet.promise)
      .mockReturnValueOnce(secondDefaultNet.promise)
    setup.getNetCapabilities.mockImplementation((handle) =>
      handle === 'cellular' ? secondCapabilities.promise : firstCapabilities.promise
    )

    setup.emitNative('netAvailable')
    setup.emitNative('netAvailable')
    secondDefaultNet.resolve('cellular')
    await flushPromises()
    secondCapabilities.resolve(capabilities(NetBearType.BEARER_CELLULAR))
    await flushPromises()

    firstDefaultNet.resolve('wifi')
    await flushPromises()
    firstCapabilities.resolve(capabilities(NetBearType.BEARER_WIFI))
    await flushPromises()

    expect(setup.emissions.map(({ state }) => state)).toEqual([
      { isConnected: true, isInternetReachable: true, type: 'CELLULAR' }
    ])
  })

  it('deduplicates repeated network snapshots before emitting', () => {
    const setup = setupNetworkService()

    setup.emitNative('netCapabilitiesChange', { netCap: capabilities(NetBearType.BEARER_WIFI) })
    setup.emitNative('netCapabilitiesChange', { netCap: capabilities(NetBearType.BEARER_WIFI) })
    setup.emitNative('netCapabilitiesChange', {
      netCap: capabilities(NetBearType.BEARER_CELLULAR)
    })

    expect(setup.emissions.map(({ state }) => state)).toEqual([
      { isConnected: true, isInternetReachable: true, type: 'WIFI' },
      { isConnected: true, isInternetReachable: true, type: 'CELLULAR' }
    ])
  })

  it('does not publish pending async snapshots after destroy', async () => {
    const setup = setupNetworkService()
    const defaultNet = deferred<string>()
    const state = deferred<NetworkCapabilities>()
    setup.getDefaultNet.mockReturnValueOnce(defaultNet.promise)
    setup.getNetCapabilities.mockReturnValueOnce(state.promise)

    setup.emitNative('netAvailable')
    setup.service.destroy()
    defaultNet.resolve('wifi')
    await flushPromises()
    state.resolve(capabilities(NetBearType.BEARER_WIFI))
    await flushPromises()

    expect(setup.emissions).toEqual([])
    expect(setup.netConnection.unregister).toHaveBeenCalledWith(setup.registeredCallback)
  })

  it('reports failed current-state reads as unknown rather than confirmed offline', async () => {
    const setup = setupNetworkService()
    setup.getDefaultNet.mockRejectedValueOnce(new Error('native read failed'))

    await expect(setup.service.getState()).resolves.toEqual({
      isConnected: false,
      isInternetReachable: false,
      type: 'UNKNOWN'
    })
  })
})

describe('Harmony expo-network adapter', () => {
  it('does not claim connectivity when the native module is unavailable', async () => {
    vi.resetModules()
    vi.doMock('../../harmony/src/native/harmony-native-module', () => ({
      addHarmonyNativeListener: vi.fn(() => ({ remove() {} })),
      HarmonyNative: {},
      hasHarmonyNativeModule: () => false
    }))
    const network = await import('../../harmony/src/compat/expo-network')

    await expect(network.getNetworkStateAsync()).resolves.toEqual({
      isConnected: false,
      isInternetReachable: false,
      type: 'UNKNOWN'
    })

    vi.doUnmock('../../harmony/src/native/harmony-native-module')
  })
})
