import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceSettingsScreen from '../../app/voice-settings'
import type { MobileSpeechSetup } from '../dictation/mobile-dictation-setup'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

const bridge = vi.hoisted(() => ({ clients: [] as unknown[] }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight' }))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [{ id: 'host-A' }] }))
vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: bridge.clients, focused: true })
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({
      children,
      visible,
      onClose
    }: {
      children?: ReactNode
      visible: boolean
      onClose: () => void
    }) => (visible ? React.createElement('BottomDrawer', { onClose }, children) : null)
  }
})
vi.mock('../components/VoiceModelList', () => ({ VoiceModelList: 'VoiceModelList' }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const setup = (
  enabled: boolean,
  dictationMode: 'toggle' | 'hold' = 'toggle',
  status: 'downloading' | 'ready' = 'downloading'
): MobileSpeechSetup => ({
  enabled,
  dictationMode,
  selectedModelId: 'model-1',
  models: [
    {
      id: 'model-1',
      label: 'Local model',
      provider: 'local',
      sizeBytes: 100,
      recommended: true,
      status,
      progress: 0.5
    }
  ]
})
const ok = (result: unknown): RpcResponse => ({
  id: 'test',
  ok: true,
  result,
  _meta: { runtimeId: 'test' }
})

describe('VoiceSettingsScreen read ownership', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    bridge.clients = []
    vi.useRealTimers()
  })

  async function render(client: Pick<RpcClient, 'sendRequest'>) {
    bridge.clients = [{ state: 'connected', client }]
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(VoiceSettingsScreen))
      } else {
        renderer = create(createElement(VoiceSettingsScreen))
      }
      await Promise.resolve()
    })
  }

  it('does not roll back a confirmed toggle when an older download poll arrives', async () => {
    const oldPoll = deferred<RpcResponse>()
    let reads = 0
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'speech.models.list') {
          reads += 1
          return reads === 1 ? ok(setup(false)) : oldPoll.promise
        }
        if (method === 'speech.dictation.setup') {
          return ok(setup(true))
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(false)

    await act(async () => vi.advanceTimersByTimeAsync(1500))
    expect(reads).toBe(2)
    await act(async () => {
      renderer!.root.findByType('Switch' as never).props.onValueChange(true)
      await Promise.resolve()
    })
    expect(client.sendRequest).toHaveBeenCalledWith('speech.dictation.setup', { enabled: true })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)

    await act(async () => {
      oldPoll.resolve(ok(setup(false)))
      await oldPoll.promise
    })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
  })

  it.each(['before', 'after'] as const)(
    'ignores a poll started during a pending toggle when it returns %s the write',
    async (pollTiming) => {
      const pendingWrite = deferred<RpcResponse>()
      const pendingPoll = deferred<RpcResponse>()
      let reads = 0
      const client = {
        sendRequest: vi.fn(async (method: string) => {
          if (method === 'speech.models.list') {
            reads += 1
            return reads === 1 ? ok(setup(false)) : pendingPoll.promise
          }
          if (method === 'speech.dictation.setup') {
            return pendingWrite.promise
          }
          throw new Error(`Unexpected RPC: ${method}`)
        })
      }
      await render(client)
      act(() => renderer!.root.findByType('Switch' as never).props.onValueChange(true))
      await act(async () => vi.advanceTimersByTimeAsync(1500))
      expect(reads).toBe(2)

      if (pollTiming === 'after') {
        await act(async () => {
          pendingWrite.resolve(ok(setup(true)))
          await pendingWrite.promise
        })
      }
      await act(async () => {
        pendingPoll.resolve(ok(setup(false)))
        await pendingPoll.promise
      })
      expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)

      if (pollTiming === 'before') {
        await act(async () => {
          pendingWrite.resolve(ok(setup(true)))
          await pendingWrite.promise
        })
      }
    }
  )

  it('keeps a newer mode response when an older toggle response arrives later', async () => {
    const oldToggle = deferred<RpcResponse>()
    const client = {
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'speech.models.list') {
          return ok(setup(false))
        }
        if (method === 'speech.dictation.setup') {
          return (params as { enabled?: boolean }).enabled === true
            ? oldToggle.promise
            : ok(setup(true, 'hold'))
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    act(() => renderer!.root.findByType('Switch' as never).props.onValueChange(true))
    const holdButton = () =>
      renderer!.root
        .findAllByType('Pressable' as never)
        .find((node) =>
          node.findAllByType('Text' as never).some((text) => text.children.join('') === 'Hold')
        )!
    act(() => holdButton().props.onPress())
    expect(holdButton().props.style[1]).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      client.sendRequest.mock.calls.filter(([method]) => method === 'speech.dictation.setup')
    ).toHaveLength(1)

    await act(async () => {
      oldToggle.resolve(ok(setup(true, 'toggle')))
      await oldToggle.promise
    })
    expect(holdButton().props.style[1]).toBeTruthy()
    expect(client.sendRequest).toHaveBeenCalledWith('speech.dictation.setup', {
      dictationMode: 'hold'
    })
  })

  it('recovers the confirmed value after a failed change and permits a later choice', async () => {
    const recoveryRead = deferred<RpcResponse>()
    let reads = 0
    let writes = 0
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'speech.models.list') {
          reads += 1
          return reads === 1 ? ok(setup(false)) : recoveryRead.promise
        }
        if (method === 'speech.dictation.setup') {
          writes += 1
          return writes === 1
            ? { id: 'test', ok: false as const, error: { code: 'denied', message: 'Denied' } }
            : ok(setup(true))
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    await act(async () => {
      renderer!.root.findByType('Switch' as never).props.onValueChange(true)
      await Promise.resolve()
    })
    expect(reads).toBe(2)
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
    expect(
      renderer!.root
        .findAllByType('Text' as never)
        .some((node) => node.children.join('') === 'Denied')
    ).toBe(true)

    await act(async () => {
      recoveryRead.resolve(ok(setup(false)))
      await recoveryRead.promise
    })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(false)
    expect(
      renderer!.root
        .findAllByType('Text' as never)
        .some((node) => node.children.join('') === 'Denied')
    ).toBe(true)

    await act(async () => {
      renderer!.root.findByType('Switch' as never).props.onValueChange(true)
      await Promise.resolve()
    })
    expect(writes).toBe(2)
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
  })

  it('starts a replacement client read without showing or adopting old client setup', async () => {
    const oldPoll = deferred<RpcResponse>()
    let oldReads = 0
    const oldClient = {
      sendRequest: vi.fn(async (method: string) => {
        if (method !== 'speech.models.list') {
          throw new Error(`Unexpected RPC: ${method}`)
        }
        oldReads += 1
        return oldReads === 1 ? ok(setup(false)) : oldPoll.promise
      })
    }
    await render(oldClient)
    await act(async () => vi.advanceTimersByTimeAsync(1500))
    expect(oldReads).toBe(2)

    const replacementRead = deferred<RpcResponse>()
    const newClient = { sendRequest: vi.fn(() => replacementRead.promise) }
    await render(newClient)
    expect(newClient.sendRequest).toHaveBeenCalledWith('speech.models.list', null)
    expect(renderer!.root.findAllByType('Switch' as never)).toHaveLength(0)

    await act(async () => {
      oldPoll.resolve(ok(setup(false)))
      await oldPoll.promise
    })
    expect(renderer!.root.findAllByType('Switch' as never)).toHaveLength(0)

    await act(async () => {
      replacementRead.resolve(ok(setup(true, 'hold', 'ready')))
      await replacementRead.promise
    })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
  })

  it('does not reuse an earlier client snapshot after an A-to-B-to-A switch', async () => {
    const returningRead = deferred<RpcResponse>()
    let aReads = 0
    const clientA = {
      sendRequest: vi.fn(() => {
        aReads += 1
        return aReads === 1
          ? Promise.resolve(ok(setup(false, 'toggle', 'ready')))
          : returningRead.promise
      })
    }
    const abandonedRead = deferred<RpcResponse>()
    const clientB = { sendRequest: vi.fn(() => abandonedRead.promise) }
    await render(clientA)
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(false)
    await render(clientB)
    expect(renderer!.root.findAllByType('Switch' as never)).toHaveLength(0)

    await render(clientA)
    expect(clientA.sendRequest).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findAllByType('Switch' as never)).toHaveLength(0)
    await act(async () => {
      abandonedRead.resolve(ok(setup(true, 'hold', 'ready')))
      await abandonedRead.promise
    })
    expect(renderer!.root.findAllByType('Switch' as never)).toHaveLength(0)
    await act(async () => {
      returningRead.resolve(ok(setup(true, 'toggle', 'ready')))
      await returningRead.promise
    })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
  })

  it('refreshes model progress after a download acknowledgement', async () => {
    const initial = setup(true, 'toggle', 'ready')
    initial.models[0]!.status = 'not-downloaded'
    const downloading = setup(true)
    let reads = 0
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'speech.models.list') {
          reads += 1
          return ok(reads === 1 ? initial : downloading)
        }
        if (method === 'speech.models.download') {
          return ok({ started: true })
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    const modelRow = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) =>
        node
          .findAllByType('Text' as never)
          .some((text) => text.children.join('') === 'Speech Model')
      )!
    act(() => modelRow.props.onPress())
    const modelList = () => renderer!.root.findByType('VoiceModelList' as never)
    await act(async () => {
      modelList().props.onDownload(initial.models[0])
      await Promise.resolve()
    })
    expect(reads).toBe(2)
    expect(modelList().props.setup.models[0].status).toBe('downloading')
  })

  it('does not let a poll during model selection restore the old model', async () => {
    const initial = { ...setup(true), selectedModelId: '' }
    const selected = setup(true)
    const pendingWrite = deferred<RpcResponse>()
    const pendingPoll = deferred<RpcResponse>()
    let reads = 0
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'speech.models.list') {
          reads += 1
          return reads === 1 ? ok(initial) : pendingPoll.promise
        }
        if (method === 'speech.dictation.setup') {
          return pendingWrite.promise
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    const modelRow = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) =>
        node
          .findAllByType('Text' as never)
          .some((text) => text.children.join('') === 'Speech Model')
      )!
    act(() => modelRow.props.onPress())
    const modelList = () => renderer!.root.findByType('VoiceModelList' as never)
    act(() => modelList().props.onUseModel(initial.models[0]))
    await act(async () => vi.advanceTimersByTimeAsync(1500))
    expect(reads).toBe(2)
    await act(async () => {
      pendingWrite.resolve(ok(selected))
      await pendingWrite.promise
    })
    await act(async () => {
      pendingPoll.resolve(ok(initial))
      await pendingPoll.promise
    })
    expect(renderer!.root.findByType('Switch' as never).props.value).toBe(true)
    expect(
      renderer!.root
        .findAllByType('Text' as never)
        .some((text) => text.children.join('') === 'Local model')
    ).toBe(true)
  })

  it('shows a deleted model as removed after closing the drawer and changing mode', async () => {
    const initial = setup(true, 'toggle', 'ready')
    const removed = { ...setup(true, 'hold', 'ready'), selectedModelId: '' }
    removed.models[0]!.status = 'not-downloaded'
    const pendingDelete = deferred<RpcResponse>()
    let deleted = false
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'speech.models.list') {
          return ok(initial)
        }
        if (method === 'speech.models.delete') {
          await pendingDelete.promise
          deleted = true
          return ok(removed)
        }
        if (method === 'speech.dictation.setup') {
          return ok(deleted ? removed : { ...initial, dictationMode: 'hold' })
        }
        throw new Error(`Unexpected RPC: ${method}`)
      })
    }
    await render(client)
    const modelRow = () =>
      renderer!.root
        .findAllByType('Pressable' as never)
        .find((node) =>
          node
            .findAllByType('Text' as never)
            .some((text) => text.children.join('') === 'Speech Model')
        )!
    act(() => modelRow().props.onPress())
    act(() =>
      renderer!.root.findByType('VoiceModelList' as never).props.onDelete(initial.models[0])
    )
    act(() => renderer!.root.findByType('BottomDrawer' as never).props.onClose())
    const holdButton = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) =>
        node.findAllByType('Text' as never).some((text) => text.children.join('') === 'Hold')
      )!
    await act(async () => {
      holdButton.props.onPress()
      await Promise.resolve()
    })
    expect(client.sendRequest).not.toHaveBeenCalledWith('speech.dictation.setup', expect.anything())

    await act(async () => {
      pendingDelete.resolve(ok(removed))
      await pendingDelete.promise
    })
    expect(
      renderer!.root
        .findAllByType('Text' as never)
        .some((text) => text.children.join('') === 'None selected')
    ).toBe(true)
    act(() => modelRow().props.onPress())
    expect(renderer!.root.findByType('VoiceModelList' as never).props.setup.models[0].status).toBe(
      'not-downloaded'
    )
  })
})
