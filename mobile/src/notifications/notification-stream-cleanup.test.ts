import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'
import { RpcClientStreamRegistry } from '../transport/rpc-client-stream-registry'
import { MobileRelayRpcStreams } from '../transport/mobile-relay-rpc-streams'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 18 } }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} }
}))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: async () => false }))

beforeEach(() => resetHostNotificationSessionsForTests())
describe.each(['direct', 'relay'] as const)('%s desktop notification teardown', (kind) => {
  it.each([false, true])(
    'releases exactly one server listener when ready=%s',
    async (readyFirst) => {
      let id = 0
      const requests: Array<{ id: string; method: string; params?: unknown }> = []
      const nextId = () => `rpc-${++id}`
      const sendFrame = (request: unknown) => {
        requests.push(request as (typeof requests)[number])
        return true
      }
      const streams =
        kind === 'direct'
          ? new RpcClientStreamRegistry({
              nextId,
              deviceToken: 'test-token',
              getState: () => 'connected',
              sendEncrypted: sendFrame
            })
          : new MobileRelayRpcStreams({ nextId, sendFrame, waitForConnected: async () => {} })
      const client = {
        subscribe: streams.subscribe.bind(streams),
        getState: () => 'connected',
        sendRequest: async (method: string, params: unknown) => {
          sendFrame({ id: nextId(), method, params })
          return { id: 'response', ok: true, result: { notifications: [] } }
        }
      } as unknown as RpcClient
      const dispose = subscribeToDesktopNotifications(client, 'host-1')
      await Promise.resolve()
      const requestId = requests[0]!.id
      const ready = () =>
        streams.handleResponse({
          id: requestId,
          ok: true,
          streaming: true,
          result: { type: 'ready', subscriptionId: 'notifications-owner', epoch: 'epoch-1' },
          _meta: { runtimeId: 'runtime-1' }
        })
      if (readyFirst) {
        ready()
      }
      dispose()
      if (!readyFirst) {
        ready()
      }
      await Promise.resolve()
      expect(requests.filter((request) => request.method === 'notifications.unsubscribe')).toEqual([
        expect.objectContaining({ params: { subscriptionId: 'notifications-owner' } })
      ])
      expect(requests.some((request) => request.method === 'notifications.getMissedSince')).toBe(
        false
      )
    }
  )
})
