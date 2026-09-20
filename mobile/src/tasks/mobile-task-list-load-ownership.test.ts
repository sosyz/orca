import { describe, expect, it, vi } from 'vitest'
import { createMobileTaskListLoadOwnership } from './mobile-task-list-load-ownership'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('mobile task list load ownership', () => {
  it('does not let an old status callback start a list load after the provider changes', async () => {
    const owner = createMobileTaskListLoadOwnership()
    const statusAck = deferred<void>()
    const listAck = deferred<string[]>()
    const sendListRequest = vi.fn(() => listAck.promise)
    let items: string[] = []
    const loadA = async () => {
      const isCurrent = owner.begin(loadA)
      if (!isCurrent) {
        return
      }
      const result = await sendListRequest()
      if (isCurrent()) {
        items = result
      }
    }
    const loadB = async () => {
      const isCurrent = owner.begin(loadB)
      if (!isCurrent) {
        return
      }
      const result = await sendListRequest()
      if (isCurrent()) {
        items = result
      }
    }
    owner.publish(loadA)
    const statusCompletion = statusAck.promise.then(loadA)

    owner.invalidate(loadA)
    owner.publish(loadB)
    const currentLoad = loadB()
    statusAck.resolve()
    await statusCompletion
    expect(sendListRequest).toHaveBeenCalledTimes(1)
    listAck.resolve(['B issue'])
    await currentLoad
    expect(items).toEqual(['B issue'])
  })

  it('invalidates an in-flight result on commit before the next passive refresh', async () => {
    const owner = createMobileTaskListLoadOwnership()
    const oldResult = deferred<string[]>()
    let items = ['B issue']
    const loadA = async () => {
      const isCurrent = owner.begin(loadA)
      if (!isCurrent) {
        return
      }
      const result = await oldResult.promise
      if (isCurrent()) {
        items = result
      }
    }
    const loadB = async () => {
      const isCurrent = owner.begin(loadB)
      if (isCurrent?.()) {
        items = ['B refreshed']
      }
    }
    owner.publish(loadA)
    const pending = loadA()
    owner.invalidate(loadA)
    owner.publish(loadB)
    oldResult.resolve(['A issue'])
    await pending
    expect(items).toEqual(['B issue'])
    await loadB()
    expect(items).toEqual(['B refreshed'])
  })

  it('drops a response after unmount, including a remounted identical callback', async () => {
    const owner = createMobileTaskListLoadOwnership()
    const load = vi.fn()
    owner.publish(load)
    const isCurrent = owner.begin(load)!
    owner.invalidate(load)
    expect(isCurrent()).toBe(false)
    expect(owner.begin(load)).toBeNull()
    owner.publish(load)
    expect(isCurrent()).toBe(false)
    expect(owner.begin(load)).not.toBeNull()
  })
})
