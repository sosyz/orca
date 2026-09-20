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

function setup() {
  const windows = new Map<object, { setWindowKeepScreenOn: ReturnType<typeof vi.fn> }>()
  const getLastWindow = vi.fn(async (context: object) => windows.get(context))
  const { HarmonyKeepAwakeService } = loadHarmonyNativeService<{
    HarmonyKeepAwakeService: new (context: object) => {
      activate(tag: string): Promise<void>
      clear(): Promise<void>
      deactivate(tag: string): Promise<void>
      setForeground(foreground: boolean): Promise<void>
    }
  }>('HarmonyKeepAwakeService.ets', { '@kit.ArkUI': { window: { getLastWindow } } })
  function createContext() {
    const context = {}
    const mainWindow = { setWindowKeepScreenOn: vi.fn(async (_active: boolean) => undefined) }
    windows.set(context, mainWindow)
    return { context, mainWindow }
  }
  return { createContext, getLastWindow, HarmonyKeepAwakeService }
}

describe('Harmony keep-awake service', () => {
  it('serializes old module cleanup with a replacement owner for the same Ability', async () => {
    const { createContext, getLastWindow, HarmonyKeepAwakeService } = setup()
    const { context, mainWindow } = createContext()
    const oldService = new HarmonyKeepAwakeService(context)
    const newService = new HarmonyKeepAwakeService(context)
    await oldService.activate('old')

    const delayedWindow = deferred<typeof mainWindow>()
    getLastWindow.mockImplementationOnce(() => delayedWindow.promise)
    const clearing = oldService.clear()
    await vi.waitFor(() => expect(getLastWindow).toHaveBeenCalledTimes(2))
    const activating = newService.activate('new')
    await Promise.resolve()
    await Promise.resolve()
    expect(mainWindow.setWindowKeepScreenOn).toHaveBeenCalledTimes(1)

    delayedWindow.resolve(mainWindow)
    await Promise.all([clearing, activating])
    expect(mainWindow.setWindowKeepScreenOn.mock.calls.at(-1)).toEqual([true])
  })

  it('keeps independent Ability windows isolated', async () => {
    const { createContext, HarmonyKeepAwakeService } = setup()
    const first = createContext()
    const second = createContext()
    const firstService = new HarmonyKeepAwakeService(first.context)
    const secondService = new HarmonyKeepAwakeService(second.context)

    await firstService.activate('first')
    await secondService.activate('second')
    await firstService.clear()

    expect(first.mainWindow.setWindowKeepScreenOn.mock.calls).toEqual([[true], [false]])
    expect(second.mainWindow.setWindowKeepScreenOn.mock.calls).toEqual([[true]])
  })

  it('does not let a failed old activation rollback turn off a replacement owner', async () => {
    const { createContext, HarmonyKeepAwakeService } = setup()
    const { context, mainWindow } = createContext()
    const oldService = new HarmonyKeepAwakeService(context)
    const newService = new HarmonyKeepAwakeService(context)
    const firstApply = deferred<void>()
    mainWindow.setWindowKeepScreenOn.mockImplementationOnce(() => firstApply.promise)

    const oldActivation = oldService.activate('old')
    await vi.waitFor(() => expect(mainWindow.setWindowKeepScreenOn).toHaveBeenCalledOnce())
    const clearing = oldService.clear()
    const newActivation = newService.activate('new')
    firstApply.reject(new Error('old window apply failed'))

    await expect(oldActivation).rejects.toThrow('old window apply failed')
    await Promise.all([clearing, newActivation])
    expect(mainWindow.setWindowKeepScreenOn.mock.calls.at(-1)).toEqual([true])
  })

  it('does not roll back a newer activation of the same tag after an intervening release', async () => {
    const { createContext, HarmonyKeepAwakeService } = setup()
    const { context, mainWindow } = createContext()
    const service = new HarmonyKeepAwakeService(context)
    const firstApply = deferred<void>()
    mainWindow.setWindowKeepScreenOn.mockImplementationOnce(() => firstApply.promise)

    const firstActivation = service.activate('recording')
    await vi.waitFor(() => expect(mainWindow.setWindowKeepScreenOn).toHaveBeenCalledOnce())
    const deactivation = service.deactivate('recording')
    const newActivation = service.activate('recording')
    firstApply.reject(new Error('old activation failed'))

    await expect(firstActivation).rejects.toThrow('old activation failed')
    await Promise.all([deactivation, newActivation])
    expect(mainWindow.setWindowKeepScreenOn.mock.calls.at(-1)).toEqual([true])
    await service.setForeground(false)
    await service.setForeground(true)
    expect(mainWindow.setWindowKeepScreenOn.mock.calls.at(-1)).toEqual([true])
  })
})
