import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createMobileTaskCreateAttempts } from './mobile-task-create-attempt'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const firstClient = {} as RpcClient
const secondClient = {} as RpcClient

describe('mobile task create attempt ownership', () => {
  it('submits once and keeps a title typed while the first create awaits its RPC', async () => {
    const attempts = createMobileTaskCreateAttempts()
    attempts.publish({ client: firstClient, hostId: 'host-a', provider: 'github', open: true })
    let title = 'First issue'
    let body = 'First body'
    const createRpc = vi.fn(() => deferred<{ number: number }>())

    const first = attempts.begin(firstClient, 'host-a', 'github')
    expect(first).not.toBeNull()
    const request = createRpc()
    expect(attempts.begin(firstClient, 'host-a', 'github')).toBeNull()
    expect(createRpc).toHaveBeenCalledTimes(1)

    const completion = request.promise.then(() => {
      if (attempts.ownsDraft(first!)) {
        title = ''
        body = ''
      }
      attempts.finish(first!)
    })
    attempts.noteDraftEdit()
    title = 'Second issue'
    attempts.noteDraftEdit()
    body = 'Second body'
    request.resolve({ number: 12 })
    await completion

    expect({ title, body }).toEqual({ title: 'Second issue', body: 'Second body' })
    expect(attempts.begin(firstClient, 'host-a', 'github')).not.toBeNull()
  })

  it('does not let an old client completion release the new host submission', () => {
    const attempts = createMobileTaskCreateAttempts()
    attempts.publish({ client: firstClient, hostId: 'host-a', provider: 'linear', open: true })
    const oldAttempt = attempts.begin(firstClient, 'host-a', 'linear')!

    attempts.publish({ client: secondClient, hostId: 'host-b', provider: 'linear', open: true })
    const newAttempt = attempts.begin(secondClient, 'host-b', 'linear')!
    expect(attempts.ownsDraft(oldAttempt)).toBe(false)
    expect(attempts.ownsSource(oldAttempt)).toBe(false)
    expect(attempts.finish(oldAttempt)).toBe(false)
    expect(attempts.isBusy()).toBe(true)
    expect(attempts.finish(newAttempt)).toBe(true)
    expect(attempts.isBusy()).toBe(false)
  })

  it('keeps a reopened create sheet when the prior accepted create completes', () => {
    const attempts = createMobileTaskCreateAttempts()
    attempts.publish({ client: firstClient, hostId: 'host-a', provider: 'gitlab', open: true })
    const oldAttempt = attempts.begin(firstClient, 'host-a', 'gitlab')!
    attempts.publish({ client: firstClient, hostId: 'host-a', provider: 'gitlab', open: false })
    attempts.publish({ client: firstClient, hostId: 'host-a', provider: 'gitlab', open: true })

    expect(attempts.ownsDraft(oldAttempt)).toBe(false)
    expect(attempts.begin(firstClient, 'host-a', 'gitlab')).toBeNull()
    expect(attempts.finish(oldAttempt)).toBe(true)
    expect(attempts.begin(firstClient, 'host-a', 'gitlab')).not.toBeNull()
  })
})
