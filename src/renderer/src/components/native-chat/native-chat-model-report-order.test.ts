import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

describe('live model reports during command dispatch', () => {
  beforeEach(() => clearNativeChatSessionOptionCacheForTests())

  it.each(['haiku', 'opus'])(
    'preserves a live %s report received during a pending model change',
    async (model) => {
      let complete!: () => void
      const dispatch = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve
          })
      )
      const persist = vi.fn()
      const surface = createNativeChatPtySessionOptions({
        agent: 'claude',
        scopeKey: 'pty-live-report',
        mode: 'live',
        reportedValues: { model: 'sonnet' },
        dispatchCommand: dispatch,
        persistSelection: persist
      })!
      const pending = surface.setOption('model', 'opus')
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled())
      surface.reportSessionOptions({ model })
      const confirmed = surface.getSnapshot()[0]
      complete()
      await pending
      expect(surface.getSnapshot()[0]).toEqual(confirmed)
      expect(surface.getSnapshot()[0]).toMatchObject({ valueSource: 'reported' })
      expect(persist).not.toHaveBeenCalled()
    }
  )

  it('does not treat a repeated unchanged report as replacement model evidence', async () => {
    let complete!: () => void
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-repeat-report',
      mode: 'live',
      reportedValues: { model: 'sonnet' },
      dispatchCommand: dispatch
    })!
    const pending = surface.setOption('model', 'opus')
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled())
    surface.reportSessionOptions({ model: 'sonnet' })
    complete()
    await pending
    expect(surface.getSnapshot()[0]).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: 'opus' }
    })
  })

  it.each(['unknown', 'interaction-required'] as const)(
    'retains a newer model report when the dispatch outcome is %s',
    async (outcome) => {
      let complete!: () => void
      const dispatch = vi.fn(
        () =>
          new Promise<{ outcome: typeof outcome }>((resolve) => {
            complete = () => resolve({ outcome })
          })
      )
      const surface = createNativeChatPtySessionOptions({
        agent: 'claude',
        scopeKey: 'pty-unconfirmed-report',
        mode: 'live',
        reportedValues: { model: 'sonnet' },
        dispatchCommand: dispatch
      })!
      const pending = surface.setOption('model', 'opus')
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled())
      surface.reportSessionOptions({ model: 'haiku' })
      complete()
      await (outcome === 'unknown'
        ? expect(pending).rejects.toThrow('Could not verify the model change')
        : pending)
      expect(surface.getSnapshot()[0]).toMatchObject({
        valueSource: 'reported',
        kind: { currentValue: 'haiku' }
      })
    }
  )
})
