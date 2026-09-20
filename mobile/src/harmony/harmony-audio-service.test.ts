import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function setupAudioService() {
  const start = deferred<void>()
  const firstRelease = deferred<void>()
  const release = vi
    .fn<() => Promise<void>>()
    .mockReturnValueOnce(firstRelease.promise)
    .mockRejectedValueOnce(new Error('late release failed'))
  const capturer = {
    state: 1,
    on: vi.fn(),
    off: vi.fn(),
    start: vi.fn(() => start.promise),
    stop: vi.fn(async () => undefined),
    release
  }
  const emissions: Array<{ eventName: string; payload: object }> = []
  const { HarmonyAudioService } = loadHarmonyNativeService<{
    HarmonyAudioService: new (
      permissions: object,
      emit: (eventName: string, payload: object) => void
    ) => {
      initialize(): Promise<boolean>
      setRecording(enabled: boolean): boolean
      tearDown(): void
    }
  }>('HarmonyAudioService.ets', {
    '@kit.AudioKit': {
      audio: {
        AudioSamplingRate: { SAMPLE_RATE_16000: 16000 },
        AudioChannel: { CHANNEL_1: 1 },
        AudioSampleFormat: { SAMPLE_FORMAT_S16LE: 1 },
        AudioEncodingType: { ENCODING_TYPE_RAW: 1 },
        SourceType: { SOURCE_TYPE_VOICE_RECOGNITION: 1 },
        AudioState: {
          STATE_NEW: 0,
          STATE_PREPARED: 1,
          STATE_RUNNING: 2,
          STATE_PAUSED: 3,
          STATE_STOPPED: 4,
          STATE_RELEASED: 5
        },
        createAudioCapturer: vi.fn(async () => capturer)
      }
    },
    '@kit.BasicServicesKit': { deviceInfo: { productModel: 'phone' } },
    './HarmonyPermissionService': {}
  })
  const service = new HarmonyAudioService({ isGranted: () => true }, (eventName, payload) =>
    emissions.push({ eventName, payload })
  )
  return { capturer, emissions, firstRelease, service, start }
}

describe('Harmony audio service', () => {
  it('ignores late release failures after recording is torn down', async () => {
    const { capturer, emissions, firstRelease, service, start } = setupAudioService()
    await expect(service.initialize()).resolves.toBe(true)
    expect(service.setRecording(true)).toBe(true)
    await vi.waitFor(() => expect(capturer.start).toHaveBeenCalledOnce())

    service.tearDown()
    expect(capturer.release).toHaveBeenCalledOnce()
    start.resolve()
    firstRelease.reject(new Error('initial release failed'))
    await vi.waitFor(() => expect(capturer.release).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    await Promise.resolve()

    expect(emissions).toEqual([])
  })
})
