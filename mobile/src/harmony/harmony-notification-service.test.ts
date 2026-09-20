import { describe, expect, it, vi } from 'vitest'
import { loadHarmonyNativeService } from './harmony-native-service-test-harness'

type NotificationService = {
  schedule(content: { title: string }): Promise<string>
  dismiss(identifier: string): Promise<void>
}

describe('Harmony notification service', () => {
  it('does not clear a newer tap after JavaScript read an older response', () => {
    type Response = { notification: { request: { identifier: string } } }
    type NotificationState = {
      clear(): void
      clearIfMatches(identifier: string): boolean
      getLast(): Response | null
      receiveWant(want: { parameters: Record<string, string> }): void
    }
    const { HarmonyNotificationState: state } = loadHarmonyNativeService<{
      HarmonyNotificationState: NotificationState
    }>('HarmonyNotificationState.ets', {})
    const receive = (identifier: string) =>
      state.receiveWant({ parameters: { 'orca.notification.id': identifier } })

    receive('first')
    const first = state.getLast()
    receive('second')

    expect(state.clearIfMatches(first!.notification.request.identifier)).toBe(false)
    expect(state.getLast()?.notification.request.identifier).toBe('second')
    expect(state.clearIfMatches('second')).toBe(true)
    expect(state.getLast()).toBeNull()
    expect(state.clearIfMatches('second')).toBe(false)

    receive('legacy')
    state.clear()
    expect(state.getLast()).toBeNull()
  })

  it('keeps concurrent notification identifiers stable when want agents resolve out of order', async () => {
    const pendingAgents: Array<{ requestCode: number; resolve: (agent: object) => void }> = []
    const publish = vi.fn(async () => undefined)
    const cancel = vi.fn(async () => undefined)
    const { HarmonyNotificationService } = loadHarmonyNativeService<{
      HarmonyNotificationService: new (context: object) => NotificationService
    }>('HarmonyNotificationService.ets', {
      '@kit.AbilityKit': {
        wantAgent: {
          OperationType: { START_ABILITY: 1 },
          WantAgentFlags: { UPDATE_PRESENT_FLAG: 1 },
          getWantAgent: ({ requestCode }: { requestCode: number }) =>
            new Promise((resolve) => pendingAgents.push({ requestCode, resolve }))
        }
      },
      '@kit.ArkData': { preferences: { getPreferencesSync: () => ({}) } },
      '@kit.NotificationKit': {
        notificationManager: {
          ContentType: { NOTIFICATION_CONTENT_BASIC_TEXT: 1 },
          SlotType: { SERVICE_INFORMATION: 1 },
          publish,
          cancel
        }
      },
      './HarmonyNotificationState': {
        HarmonyNotificationState: {
          identifierKey: () => 'identifier',
          dataKey: () => 'data'
        }
      }
    })
    const service = new HarmonyNotificationService({
      abilityInfo: { bundleName: 'test.bundle', name: 'EntryAbility' }
    })
    const first = service.schedule({ title: 'First task' })
    const second = service.schedule({ title: 'Second task' })
    pendingAgents[1].resolve({ task: 'second' })
    const secondIdentifier = await second
    pendingAgents[0].resolve({ task: 'first' })
    const firstIdentifier = await first

    expect(firstIdentifier).not.toBe(secondIdentifier)
    expect(publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: Number(secondIdentifier), wantAgent: { task: 'second' } })
    )
    expect(publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: Number(firstIdentifier), wantAgent: { task: 'first' } })
    )
    expect(pendingAgents.map(({ requestCode }) => String(requestCode))).toEqual([
      firstIdentifier,
      secondIdentifier
    ])
    await service.dismiss(firstIdentifier)
    await service.dismiss(secondIdentifier)
    expect(cancel.mock.calls).toEqual([[Number(firstIdentifier)], [Number(secondIdentifier)]])

    cancel.mockClear()
    await service.dismiss(`${firstIdentifier}suffix`)
    await service.dismiss('01')
    await service.dismiss('2000000000')
    await service.dismiss('-1')
    expect(cancel).not.toHaveBeenCalled()
  })
})
