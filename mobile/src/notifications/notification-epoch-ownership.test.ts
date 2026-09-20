import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import {
  getHostNotificationSession,
  resetHostNotificationSessionsForTests
} from './notification-reconnect-catchup'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled'),
  dismissNotificationAsync: vi.fn(async () => {})
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 18 } }))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn(async () => true)
}))
const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    })
  }
}))
const WATERMARK_KEY = 'orca:mobileNotificationsWatermark:epoch-host'
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function flush() {
  for (let i = 0; i < 35; i += 1) {
    await Promise.resolve()
  }
}
function makeHost(epoch: string, missed?: Promise<unknown>) {
  let receive: (event: unknown) => void = () => {}
  const client = {
    getState: () => 'connected',
    subscribe: vi.fn((_method, _params, callback) => {
      receive = callback
      return vi.fn()
    }),
    sendRequest: vi.fn(async (method: string) =>
      method === 'notifications.getMissedSince'
        ? (missed ?? { ok: true, result: { epoch, notifications: [] } })
        : { ok: true }
    )
  }
  return {
    client: client as unknown as RpcClient,
    ready: (nextEpoch = epoch) =>
      receive({ type: 'ready', subscriptionId: `sub-${nextEpoch}`, epoch: nextEpoch }),
    show: (seq: number) =>
      receive({
        type: 'notification',
        source: 'agent',
        title: `${epoch}-${seq}`,
        body: 'done',
        notificationSeq: seq,
        notificationEpoch: epoch
      }),
    sendRequest: client.sendRequest
  }
}
function persisted() {
  return JSON.parse(storage.get(WATERMARK_KEY) ?? '{}')
}

describe('notification counter ownership across reconnects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    resetHostNotificationSessionsForTests()
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('scheduled')
  })

  it('does not assign an old in-flight notification sequence to a new desktop counter', async () => {
    const scheduled = deferred<string>()
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(scheduled.promise)
    const old = makeHost('old')
    const stop = subscribeToDesktopNotifications(old.client, 'epoch-host')
    old.ready()
    await flush()
    old.show(100)
    await flush()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    stop()
    const current = makeHost('new')
    const stopCurrent = subscribeToDesktopNotifications(current.client, 'epoch-host')
    current.ready()
    await flush()
    scheduled.resolve('old-scheduled')
    await flush()
    current.show(1)
    await flush()
    expect(persisted()).toEqual({ epoch: 'new', seq: 1 })
    stopCurrent()
  })

  it.each(['success', 'failure'] as const)(
    'ignores a late old catch-up %s after the counter changes',
    async (outcome) => {
      storage.set(WATERMARK_KEY, JSON.stringify({ epoch: 'old', seq: 5 }))
      const response = deferred<unknown>()
      const old = makeHost('old', response.promise)
      const stop = subscribeToDesktopNotifications(old.client, 'epoch-host')
      old.ready()
      await flush()
      expect(old.sendRequest).toHaveBeenCalledWith('notifications.getMissedSince', {
        lastSeenSeq: 5,
        epoch: 'old'
      })
      stop()
      const current = makeHost('new')
      const stopCurrent = subscribeToDesktopNotifications(current.client, 'epoch-host')
      current.ready()
      await flush()
      current.show(10)
      await flush()
      expect(persisted()).toEqual({ epoch: 'new', seq: 10 })
      if (outcome === 'success') {
        response.resolve({ ok: true, result: { epoch: 'old', notifications: [] } })
      } else {
        response.reject(new Error('old socket closed'))
      }
      await flush()
      expect(persisted()).toEqual({ epoch: 'new', seq: 10 })
      expect(getHostNotificationSession('epoch-host').catchUpQuarantineSeq).toBeNull()
      stopCurrent()
    }
  )

  it('drops old queued live delivery after subscription teardown', async () => {
    const scheduled = deferred<string>()
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(scheduled.promise)
    const old = makeHost('old')
    const stop = subscribeToDesktopNotifications(old.client, 'epoch-host')
    old.ready()
    await flush()
    old.show(100)
    old.show(101)
    await flush()
    stop()
    const current = makeHost('new')
    const stopCurrent = subscribeToDesktopNotifications(current.client, 'epoch-host')
    current.ready()
    await flush()
    scheduled.resolve('old-scheduled')
    await flush()
    expect(
      vi
        .mocked(Notifications.scheduleNotificationAsync)
        .mock.calls.map(([request]) => request.content.title)
    ).toEqual(['old-100'])
    expect(persisted()).toEqual({ epoch: 'new', seq: 0 })
    stopCurrent()
  })

  it('drops queued delivery from an older ready on the same subscription', async () => {
    const scheduled = deferred<string>()
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(scheduled.promise)
    const host = makeHost(
      'old',
      Promise.resolve({ ok: true, result: { epoch: 'new', notifications: [] } })
    )
    const stop = subscribeToDesktopNotifications(host.client, 'epoch-host')
    host.ready()
    await flush()
    host.show(100)
    host.show(101)
    await flush()
    host.ready('new')
    await flush()
    scheduled.resolve('old-scheduled')
    await flush()
    expect(
      vi
        .mocked(Notifications.scheduleNotificationAsync)
        .mock.calls.map(([request]) => request.content.title)
    ).toEqual(['old-100'])
    expect(persisted()).toEqual({ epoch: 'new', seq: 0 })
    stop()
  })

  it('cannot release a new counter quarantine when an old replay finishes', async () => {
    storage.set(WATERMARK_KEY, JSON.stringify({ epoch: 'old', seq: 5 }))
    const scheduled = deferred<string>()
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(scheduled.promise)
    const old = makeHost(
      'old',
      Promise.resolve({
        ok: true,
        result: {
          epoch: 'old',
          notifications: [
            {
              type: 'notification',
              title: 'old-100',
              body: 'done',
              notificationSeq: 100,
              notificationEpoch: 'old'
            }
          ]
        }
      })
    )
    const stop = subscribeToDesktopNotifications(old.client, 'epoch-host')
    old.ready()
    await flush()
    stop()
    const current = makeHost('new', Promise.resolve({ ok: false }))
    const stopCurrent = subscribeToDesktopNotifications(current.client, 'epoch-host')
    current.ready()
    await flush()
    current.show(10)
    scheduled.resolve('old-scheduled')
    await flush()
    expect(getHostNotificationSession('epoch-host').catchUpQuarantineSeq).toBe(0)
    expect(persisted()).toEqual({ epoch: 'new', seq: 0 })
    stopCurrent()
  })

  it('keeps an unreplayed gap across three ready events in one epoch', async () => {
    storage.set(WATERMARK_KEY, JSON.stringify({ epoch: 'stable', seq: 5 }))
    const firstSchedule = deferred<string>()
    const secondCatchUp = deferred<unknown>()
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(firstSchedule.promise)
    const host = makeHost('stable')
    let catchUpCount = 0
    host.sendRequest.mockImplementation(async (method: string, params?: unknown) => {
      if (method !== 'notifications.getMissedSince') {
        return { ok: true }
      }
      catchUpCount += 1
      if (catchUpCount === 1) {
        return {
          ok: true,
          result: {
            epoch: 'stable',
            notifications: [6, 7, 8, 9, 10].map((seq) => ({
              type: 'notification',
              source: 'agent',
              title: `stable-${seq}`,
              body: 'done',
              notificationSeq: seq,
              notificationEpoch: 'stable'
            }))
          }
        }
      }
      if (catchUpCount === 2) {
        return secondCatchUp.promise
      }
      const lastSeenSeq = (params as { lastSeenSeq: number }).lastSeenSeq
      return {
        ok: true,
        result: {
          epoch: 'stable',
          notifications: [6, 7, 8, 9, 10]
            .filter((seq) => seq > lastSeenSeq)
            .map((seq) => ({
              type: 'notification',
              title: `stable-${seq}`,
              body: 'done',
              notificationSeq: seq,
              notificationEpoch: 'stable'
            }))
        }
      }
    })
    const stop = subscribeToDesktopNotifications(host.client, 'epoch-host')

    host.ready()
    await flush()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    host.ready()
    await flush()
    expect(catchUpCount).toBe(2)
    host.show(11)
    await flush()
    firstSchedule.resolve('scheduled-6')
    await flush()
    expect(persisted()).toEqual({ epoch: 'stable', seq: 5 })

    host.ready()
    await flush()
    const asks = host.sendRequest.mock.calls
      .filter(([method]) => method === 'notifications.getMissedSince')
      .map(([, params]) => params)
    expect(asks).toEqual([
      { lastSeenSeq: 5, epoch: 'stable' },
      { lastSeenSeq: 5, epoch: 'stable' },
      { lastSeenSeq: 5, epoch: 'stable' }
    ])
    expect(persisted()).toEqual({ epoch: 'stable', seq: 5 })
    secondCatchUp.resolve({ ok: true, result: { epoch: 'stable', notifications: [] } })
    await flush()
    expect(
      vi
        .mocked(Notifications.scheduleNotificationAsync)
        .mock.calls.map(([request]) => request.content.title)
        .sort()
    ).toEqual(['stable-6', 'stable-7', 'stable-8', 'stable-9', 'stable-10', 'stable-11'].sort())
    stop()
  })

  it('rejects old ready and live callbacks that waited for the same stored seed', async () => {
    const seed = deferred<string | null>()
    vi.mocked(AsyncStorage.getItem).mockReturnValueOnce(seed.promise)
    const host = makeHost(
      'old',
      Promise.resolve({ ok: true, result: { epoch: 'new', notifications: [] } })
    )
    const stop = subscribeToDesktopNotifications(host.client, 'epoch-host')
    host.ready()
    host.show(100)
    host.ready('new')
    seed.resolve(JSON.stringify({ epoch: 'old', seq: 5 }))
    await flush()
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(host.sendRequest).toHaveBeenCalledTimes(1)
    expect(host.sendRequest).toHaveBeenCalledWith('notifications.getMissedSince', {
      lastSeenSeq: 0,
      epoch: 'new'
    })
    expect(persisted()).toEqual({ epoch: 'new', seq: 0 })
    stop()
  })

  it('restarts from the undelivered floor while a previous catch-up was pending', async () => {
    storage.set(WATERMARK_KEY, JSON.stringify({ epoch: 'stable', seq: 5 }))
    const response = deferred<unknown>()
    const old = makeHost('stable', response.promise)
    const stop = subscribeToDesktopNotifications(old.client, 'epoch-host')
    old.ready()
    await flush()
    old.show(11)
    await flush()
    expect(persisted()).toEqual({ epoch: 'stable', seq: 5 })
    stop()
    resetHostNotificationSessionsForTests()
    const restarted = makeHost('stable')
    const stopRestarted = subscribeToDesktopNotifications(restarted.client, 'epoch-host')
    restarted.ready()
    await flush()
    expect(restarted.sendRequest).toHaveBeenCalledWith('notifications.getMissedSince', {
      lastSeenSeq: 5,
      epoch: 'stable'
    })
    stopRestarted()
  })

  it('uses the new counter floor when a catch-up response discovers a desktop restart', async () => {
    storage.set(WATERMARK_KEY, JSON.stringify({ epoch: 'old', seq: 100 }))
    vi.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(
      new Error('OS unavailable')
    )
    const host = makeHost(
      'old',
      Promise.resolve({
        ok: true,
        result: {
          epoch: 'new',
          notifications: [
            {
              type: 'notification',
              title: 'new-1',
              body: 'done',
              notificationSeq: 1,
              notificationEpoch: 'new'
            }
          ]
        }
      })
    )
    const stop = subscribeToDesktopNotifications(host.client, 'epoch-host')
    host.ready()
    await flush()
    expect(getHostNotificationSession('epoch-host').catchUpQuarantineSeq).toBe(0)
    expect(persisted()).toEqual({ epoch: 'new', seq: 0 })
    stop()
  })
})
