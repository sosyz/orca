import { Fragment, createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileDictation, type UseMobileDictationResult } from './use-mobile-dictation'
import type { RpcClient } from '../transport/rpc-client'

type PermissionResult = {
  granted: boolean
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const audio = vi.hoisted(() => ({
  addExpoTwoWayAudioEventListener: vi.fn(),
  initialize: vi.fn(),
  requestMicrophonePermissionsAsync: vi.fn(),
  tearDown: vi.fn(),
  toggleRecording: vi.fn()
}))

vi.mock('@orca/expo-two-way-audio', () => audio)

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(),
  deactivateKeepAwake: vi.fn()
}))

vi.mock('expo-keep-awake', () => keepAwake)

const appState = vi.hoisted(() => ({
  listener: null as ((state: string) => void) | null,
  remove: vi.fn()
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_eventName: string, listener: (state: string) => void) => {
      appState.listener = listener
      return { remove: appState.remove }
    },
    currentState: 'active'
  },
  Platform: { OS: 'ios' }
}))

describe('useMobileDictation', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: UseMobileDictationResult | null = null
  let client: RpcClient
  let sendRequest: ReturnType<typeof vi.fn<RpcClient['sendRequest']>>
  const onTranscript = vi.fn()
  const onError = vi.fn()

  function Harness({
    enabled = true,
    activeClient = client,
    scopeKey = 'tab-a'
  }: {
    enabled?: boolean
    activeClient?: RpcClient
    scopeKey?: string
  }): null {
    latest = useMobileDictation({ client: activeClient, enabled, scopeKey, onTranscript, onError })
    return null
  }

  function api(): UseMobileDictationResult {
    if (!latest) {
      throw new Error('Harness was not rendered')
    }
    return latest
  }

  async function render(enabled = true): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { enabled }))
    })
  }

  beforeEach(() => {
    latest = null
    onTranscript.mockClear()
    onError.mockClear()
    audio.addExpoTwoWayAudioEventListener.mockReset()
    audio.addExpoTwoWayAudioEventListener.mockReturnValue({ remove: vi.fn() })
    audio.initialize.mockReset()
    audio.initialize.mockResolvedValue(true)
    audio.requestMicrophonePermissionsAsync.mockReset()
    audio.requestMicrophonePermissionsAsync.mockResolvedValue({ granted: true })
    audio.tearDown.mockReset()
    audio.toggleRecording.mockReset()
    audio.toggleRecording.mockReturnValue(true)
    keepAwake.activateKeepAwakeAsync.mockReset()
    keepAwake.activateKeepAwakeAsync.mockResolvedValue(undefined)
    keepAwake.deactivateKeepAwake.mockReset()
    keepAwake.deactivateKeepAwake.mockResolvedValue(undefined)
    appState.listener = null
    appState.remove.mockClear()
    sendRequest = vi.fn(async () => ({
      id: 'response',
      ok: true,
      result: {},
      _meta: { runtimeId: 'r1' }
    }))
    client = {
      close: vi.fn(),
      getLastConnectedAt: vi.fn(() => 1),
      getLastInboundAt: vi.fn(() => 1),
      getReconnectAttempt: vi.fn(() => 0),
      getState: vi.fn(() => 'connected'),
      notifyForeground: vi.fn(),
      onStateChange: vi.fn(() => () => undefined),
      sendRequest,
      subscribe: vi.fn(() => () => undefined),
      updateTerminalSubscriptionViewport: vi.fn()
    }
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('returns to idle after a microphone permission request rejects so start can retry', async () => {
    const permissionError = new Error('Microphone permission service unavailable')
    audio.requestMicrophonePermissionsAsync.mockRejectedValueOnce(permissionError)

    await render()
    await act(async () => {
      await expect(api().start()).rejects.toThrow(permissionError.message)
    })

    expect(api().status).toBe('idle')
    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => {
      await api().start()
    })

    expect(api().status).toBe('recording')
    expect(audio.requestMicrophonePermissionsAsync).toHaveBeenCalledTimes(2)
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.start', {
      dictationId: expect.stringMatching(/^mobile-dictation-/)
    })
  })

  it('cancels locally before remote cleanup and preserves a newer recording', async () => {
    const remoteCancel = deferred<Awaited<ReturnType<RpcClient['sendRequest']>>>()
    sendRequest.mockImplementation(async (method) => {
      if (method === 'speech.dictation.cancel') {
        return remoteCancel.promise
      }
      return { id: 'response', ok: true, result: {}, _meta: { runtimeId: 'r1' } }
    })
    await render()
    await act(async () => api().start())

    let cancellation!: Promise<void>
    await act(async () => {
      cancellation = api().cancel()
    })
    expect(audio.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(api().status).toBe('idle')

    await act(async () => api().start())
    expect(api().status).toBe('recording')
    await act(async () => {
      remoteCancel.resolve({
        id: 'cancelled',
        ok: true,
        result: {},
        _meta: { runtimeId: 'r1' }
      })
      await cancellation
    })
    expect(api().status).toBe('recording')
    expect(audio.toggleRecording).toHaveBeenLastCalledWith(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('cancels recording on a tab scope change before its transcript can reach the new tab', async () => {
    sendRequest.mockImplementation(async (method) => ({
      id: 'response',
      ok: true,
      result: method === 'speech.dictation.finish' ? { text: 'old tab words' } : {},
      _meta: { runtimeId: 'r1' }
    }))
    await render()
    await act(async () => api().start())
    const oldId = (
      sendRequest.mock.calls.find(([method]) => method === 'speech.dictation.start')![1] as {
        dictationId: string
      }
    ).dictationId

    await act(async () => {
      renderer!.update(createElement(Harness, { scopeKey: 'tab-b' }))
    })

    expect(api().status).toBe('idle')
    expect(audio.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.cancel', { dictationId: oldId })
    await act(async () => api().stop())
    expect(sendRequest).not.toHaveBeenCalledWith('speech.dictation.finish', { dictationId: oldId })
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('drops a late finish when the composer scope changes during processing', async () => {
    const finish = deferred<Awaited<ReturnType<RpcClient['sendRequest']>>>()
    sendRequest.mockImplementation(async (method) => {
      if (method === 'speech.dictation.finish') {
        return finish.promise
      }
      return { id: 'response', ok: true, result: {}, _meta: { runtimeId: 'r1' } }
    })
    await render()
    await act(async () => api().start())

    let pendingStop!: Promise<void>
    await act(async () => {
      pendingStop = api().stop()
    })
    expect(api().status).toBe('processing')
    await act(async () => {
      renderer!.update(createElement(Harness, { scopeKey: 'tab-b' }))
    })
    expect(api().status).toBe('idle')

    await act(async () => {
      finish.resolve({
        id: 'finished',
        ok: true,
        result: { text: 'old tab words' },
        _meta: { runtimeId: 'r1' }
      })
      await pendingStop
    })
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(api().status).toBe('idle')
  })

  it('cancels a replaced client session on its original client and keeps the new client clean', async () => {
    const originalClient = client
    const replacementSend = vi.fn<RpcClient['sendRequest']>(async () => ({
      id: 'replacement',
      ok: true,
      result: {},
      _meta: { runtimeId: 'r2' }
    }))
    const replacementClient = { ...client, sendRequest: replacementSend }
    await render()
    await act(async () => api().start())
    const oldId = (
      sendRequest.mock.calls.find(([method]) => method === 'speech.dictation.start')![1] as {
        dictationId: string
      }
    ).dictationId

    await act(async () => {
      renderer!.update(createElement(Harness, { activeClient: replacementClient }))
    })
    expect(api().status).toBe('idle')
    expect(audio.toggleRecording).toHaveBeenLastCalledWith(false)
    expect(originalClient.sendRequest).toHaveBeenCalledWith('speech.dictation.cancel', {
      dictationId: oldId
    })
    expect(replacementSend).not.toHaveBeenCalled()

    await act(async () => api().start())
    expect(replacementSend).toHaveBeenCalledWith('speech.dictation.start', {
      dictationId: expect.not.stringMatching(oldId)
    })
    expect(api().status).toBe('recording')
  })

  it('invalidates pending microphone permission when the tab scope changes', async () => {
    const permission = deferred<PermissionResult>()
    audio.requestMicrophonePermissionsAsync.mockReturnValueOnce(permission.promise)
    await render()
    let pendingStart!: Promise<void>
    await act(async () => {
      pendingStart = api().start()
    })
    expect(api().status).toBe('starting')

    await act(async () => {
      renderer!.update(createElement(Harness, { scopeKey: 'tab-b' }))
    })
    expect(api().status).toBe('idle')
    await act(async () => {
      permission.resolve({ granted: true })
      await pendingStart
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(audio.toggleRecording).not.toHaveBeenCalledWith(true)
  })

  it('cancels a desktop start that resolves after its tab scope changes', async () => {
    const remoteStart = deferred<Awaited<ReturnType<RpcClient['sendRequest']>>>()
    sendRequest.mockImplementation(async (method) =>
      method === 'speech.dictation.start'
        ? remoteStart.promise
        : { id: 'response', ok: true, result: {}, _meta: { runtimeId: 'r1' } }
    )
    await render()
    let pendingStart!: Promise<void>
    await act(async () => {
      pendingStart = api().start()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.start', {
      dictationId: expect.stringMatching(/^mobile-dictation-/)
    })

    await act(async () => {
      renderer!.update(createElement(Harness, { scopeKey: 'tab-b' }))
    })
    expect(api().status).toBe('idle')
    await act(async () => {
      remoteStart.resolve({ id: 'started', ok: true, result: {}, _meta: { runtimeId: 'r1' } })
      await pendingStart
    })
    expect(audio.toggleRecording).not.toHaveBeenCalledWith(true)
    expect(api().status).toBe('idle')
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.cancel', {
      dictationId: expect.stringMatching(/^mobile-dictation-/)
    })
  })

  it('returns to idle and tears down after microphone initialization rejects so start can retry', async () => {
    const initializeError = new Error('Microphone initialization failed')
    audio.initialize.mockRejectedValueOnce(initializeError)

    await render()
    await act(async () => {
      await expect(api().start()).rejects.toThrow(initializeError.message)
    })

    expect(api().status).toBe('idle')
    expect(audio.tearDown).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => {
      await api().start()
    })

    expect(api().status).toBe('recording')
    expect(audio.initialize).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale permission rejection after a newer start generation is recording', async () => {
    const pendingPermission = deferred<PermissionResult>()
    audio.requestMicrophonePermissionsAsync
      .mockReturnValueOnce(pendingPermission.promise)
      .mockResolvedValueOnce({ granted: true })

    await render()
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = api().start()
    })
    expect(api().status).toBe('starting')

    await act(async () => {
      await api().cancel()
      await api().start()
    })
    expect(api().status).toBe('recording')

    await act(async () => {
      pendingPermission.reject(new Error('late permission failure'))
      await staleStart
    })

    expect(api().status).toBe('recording')
    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('does not let stale initialization success from an unmounted route tear down a newer start', async () => {
    const pendingInitialize = deferred<boolean>()
    audio.initialize.mockReturnValueOnce(pendingInitialize.promise).mockResolvedValueOnce(true)

    await render()
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = api().start()
    })
    expect(api().status).toBe('starting')

    act(() => {
      renderer?.unmount()
      renderer = null
    })
    audio.tearDown.mockClear()
    await render()
    await act(async () => api().start())
    expect(api().status).toBe('recording')

    await act(async () => {
      pendingInitialize.resolve(true)
      await staleStart
    })

    expect(api().status).toBe('recording')
    expect(audio.tearDown).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('does not let an old pending route cleanup stop the newer route recorder', async () => {
    const pendingInitialize = deferred<boolean>()
    audio.initialize.mockReturnValueOnce(pendingInitialize.promise).mockResolvedValueOnce(true)
    let routeA: UseMobileDictationResult | null = null
    let routeB: UseMobileDictationResult | null = null

    function RouteA(): null {
      routeA = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function RouteB(): null {
      routeB = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function Routes({ showA, showB }: { showA: boolean; showB: boolean }): ReactElement {
      return createElement(
        Fragment,
        null,
        showA ? createElement(RouteA) : null,
        showB ? createElement(RouteB) : null
      )
    }

    await act(async () => {
      renderer = create(createElement(Routes, { showA: true, showB: false }))
    })
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = routeA!.start()
    })
    expect(routeA!.status).toBe('starting')

    await act(async () => {
      renderer!.update(createElement(Routes, { showA: true, showB: true }))
    })
    await act(async () => {
      await routeB!.start()
    })
    expect(routeB!.status).toBe('recording')

    audio.toggleRecording.mockClear()
    audio.tearDown.mockClear()
    act(() => {
      renderer!.update(createElement(Routes, { showA: false, showB: true }))
    })

    expect(audio.toggleRecording).not.toHaveBeenCalledWith(false)
    expect(audio.tearDown).not.toHaveBeenCalled()
    expect(routeB!.status).toBe('recording')

    await act(async () => {
      pendingInitialize.resolve(true)
      await staleStart
    })

    expect(routeB!.status).toBe('recording')
    expect(audio.tearDown).not.toHaveBeenCalled()
    audio.toggleRecording.mockClear()
    audio.tearDown.mockClear()

    act(() => {
      renderer!.unmount()
      renderer = null
    })

    expect(audio.toggleRecording).toHaveBeenCalledWith(false)
    expect(audio.tearDown).toHaveBeenCalledTimes(1)
  })

  it('does not let an old mounted route retake the recorder after a newer route starts', async () => {
    const pendingInitialize = deferred<boolean>()
    audio.initialize.mockReturnValueOnce(pendingInitialize.promise).mockResolvedValueOnce(true)
    let routeA: UseMobileDictationResult | null = null
    let routeB: UseMobileDictationResult | null = null

    function RouteA(): null {
      routeA = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function RouteB(): null {
      routeB = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function Routes(): ReactElement {
      return createElement(Fragment, null, createElement(RouteA), createElement(RouteB))
    }

    await act(async () => {
      renderer = create(createElement(Routes))
    })
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = routeA!.start()
    })
    expect(routeA!.status).toBe('starting')

    await act(async () => {
      await routeB!.start()
    })
    const startCalls = sendRequest.mock.calls.filter(
      ([method]) => method === 'speech.dictation.start'
    )
    expect(startCalls).toHaveLength(1)
    const activeDictationId = (startCalls[0]![1] as { dictationId: string }).dictationId
    expect(routeB!.status).toBe('recording')

    audio.toggleRecording.mockClear()
    await act(async () => {
      pendingInitialize.resolve(true)
      await staleStart
    })

    expect(routeA!.status).toBe('idle')
    expect(routeB!.status).toBe('recording')
    expect(audio.toggleRecording).not.toHaveBeenCalled()
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'speech.dictation.start')
    ).toHaveLength(1)

    sendRequest.mockClear()
    for (const [, listener] of audio.addExpoTwoWayAudioEventListener.mock.calls.filter(
      ([eventName]) => eventName === 'onMicrophoneData'
    )) {
      listener({ data: new Uint8Array([1, 2, 3]) })
    }
    await act(async () => {
      await Promise.resolve()
    })

    const chunkCalls = sendRequest.mock.calls.filter(
      ([method]) => method === 'speech.dictation.chunk'
    )
    expect(chunkCalls).toHaveLength(1)
    expect(chunkCalls[0]![1]).toMatchObject({ dictationId: activeDictationId })
  })

  it('does not let an old pending permission retake the recorder after a newer route starts', async () => {
    const pendingPermission = deferred<PermissionResult>()
    audio.requestMicrophonePermissionsAsync
      .mockReturnValueOnce(pendingPermission.promise)
      .mockResolvedValueOnce({ granted: true })
    let routeA: UseMobileDictationResult | null = null
    let routeB: UseMobileDictationResult | null = null

    function RouteA(): null {
      routeA = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function RouteB(): null {
      routeB = useMobileDictation({ client, enabled: true, onTranscript, onError })
      return null
    }

    function Routes(): ReactElement {
      return createElement(Fragment, null, createElement(RouteA), createElement(RouteB))
    }

    await act(async () => {
      renderer = create(createElement(Routes))
    })
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = routeA!.start()
    })
    expect(routeA!.status).toBe('starting')

    await act(async () => {
      await routeB!.start()
    })
    const startCalls = sendRequest.mock.calls.filter(
      ([method]) => method === 'speech.dictation.start'
    )
    expect(startCalls).toHaveLength(1)
    const activeDictationId = (startCalls[0]![1] as { dictationId: string }).dictationId
    expect(routeB!.status).toBe('recording')
    expect(audio.initialize).toHaveBeenCalledTimes(1)

    audio.toggleRecording.mockClear()
    await act(async () => {
      pendingPermission.resolve({ granted: true })
      await staleStart
    })

    expect(routeA!.status).toBe('idle')
    expect(routeB!.status).toBe('recording')
    expect(audio.initialize).toHaveBeenCalledTimes(1)
    expect(audio.toggleRecording).not.toHaveBeenCalled()
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'speech.dictation.start')
    ).toHaveLength(1)

    sendRequest.mockClear()
    for (const [, listener] of audio.addExpoTwoWayAudioEventListener.mock.calls.filter(
      ([eventName]) => eventName === 'onMicrophoneData'
    )) {
      listener({ data: new Uint8Array([4, 5, 6]) })
    }
    await act(async () => {
      await Promise.resolve()
    })

    const chunkCalls = sendRequest.mock.calls.filter(
      ([method]) => method === 'speech.dictation.chunk'
    )
    expect(chunkCalls).toHaveLength(1)
    expect(chunkCalls[0]![1]).toMatchObject({ dictationId: activeDictationId })
  })

  it('does not let stale initialization rejection from an unmounted route tear down or report over a newer start', async () => {
    const pendingInitialize = deferred<boolean>()
    audio.initialize.mockReturnValueOnce(pendingInitialize.promise).mockResolvedValueOnce(true)

    await render()
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = api().start()
    })
    act(() => {
      renderer?.unmount()
      renderer = null
    })
    audio.tearDown.mockClear()
    await render()
    await act(async () => api().start())

    await act(async () => {
      pendingInitialize.reject(new Error('late initialize failure'))
      await staleStart
    })

    expect(api().status).toBe('recording')
    expect(audio.tearDown).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale initialization rejection after the hook unmounts', async () => {
    const pendingInitialize = deferred<boolean>()
    audio.initialize.mockReturnValueOnce(pendingInitialize.promise)

    await render()
    let staleStart: Promise<void>
    await act(async () => {
      staleStart = api().start()
    })
    expect(api().status).toBe('starting')

    act(() => {
      renderer?.unmount()
      renderer = null
    })

    await act(async () => {
      pendingInitialize.reject(new Error('late initialize failure'))
      await staleStart
    })

    expect(onError).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
