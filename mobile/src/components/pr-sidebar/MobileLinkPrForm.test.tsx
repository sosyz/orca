import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerError, triggerSuccess } from '../../platform/haptics'
import type { RpcClient } from '../../transport/rpc-client'
import type { RpcResponse } from '../../transport/types'
import { MobileLinkPrForm } from './MobileLinkPrForm'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

function deferredResponse() {
  let resolve!: (value: RpcResponse) => void
  const promise = new Promise<RpcResponse>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const success: RpcResponse = {
  id: 'link',
  ok: true,
  result: {},
  _meta: { runtimeId: 'test' }
}

function renderForm(sendRequest: ReturnType<typeof vi.fn>) {
  const onLinked = vi.fn()
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(MobileLinkPrForm, {
        client: { sendRequest } as unknown as RpcClient,
        worktreeId: 'wt-A',
        onCancel: vi.fn(),
        onLinked
      })
    )
  })
  act(() => renderer.root.findByType('TextInput' as never).props.onChangeText('#7'))
  const submit = () => renderer.root.findAllByType('Pressable' as never)[1].props.onPress()
  return { renderer, onLinked, submit }
}

describe('MobileLinkPrForm', () => {
  const mounted: ReactTestRenderer[] = []

  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()))
    vi.clearAllMocks()
  })

  it('claims a same-frame double tap once and notifies once after success', async () => {
    const pending = deferredResponse()
    const sendRequest = vi.fn(() => pending.promise)
    const form = renderForm(sendRequest)
    mounted.push(form.renderer)

    act(() => {
      form.submit()
      form.submit()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenCalledWith('worktree.set', {
      worktree: 'id:wt-A',
      linkedPR: 7
    })

    await act(async () => {
      pending.resolve(success)
      await pending.promise
    })
    expect(form.onLinked).toHaveBeenCalledTimes(1)
    expect(triggerSuccess).toHaveBeenCalledTimes(1)
    expect(triggerError).not.toHaveBeenCalled()
  })

  it('releases the claim after failure so the user can retry', async () => {
    const failed = deferredResponse()
    const retried = deferredResponse()
    const sendRequest = vi
      .fn()
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retried.promise)
    const form = renderForm(sendRequest)
    mounted.push(form.renderer)

    act(() => form.submit())
    await act(async () => {
      failed.resolve({
        id: 'link',
        ok: false,
        error: { code: 'rejected', message: 'Cannot link' },
        _meta: { runtimeId: 'test' }
      })
      await failed.promise
    })
    expect(
      form.renderer.root
        .findAllByType('Text' as never)
        .some((node) => node.children.join('') === 'Cannot link')
    ).toBe(true)
    expect(triggerError).toHaveBeenCalledTimes(1)
    expect(form.onLinked).not.toHaveBeenCalled()

    act(() => form.submit())
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await act(async () => {
      retried.resolve(success)
      await retried.promise
    })
    expect(form.onLinked).toHaveBeenCalledTimes(1)
    expect(triggerSuccess).toHaveBeenCalledTimes(1)
  })
})
