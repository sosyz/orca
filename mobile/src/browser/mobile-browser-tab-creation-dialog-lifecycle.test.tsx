import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextInputModal } from '../components/TextInputModal'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileBrowserTabCreation } from './use-mobile-browser-tab-creation'

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('../components/mounted-bottom-drawer', () => ({
  MountedBottomDrawer: ({ children }: { children: React.ReactNode }) => children
}))

describe('browser creation dialog during its close animation', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mountDialog() {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { browserPageId: 'page-a' } })
    const client = { sendRequest } as unknown as RpcClient
    let creation!: ReturnType<typeof useMobileBrowserTabCreation>
    let visible = false
    function Harness({ worktreeId }: { worktreeId: string }) {
      const [modalVisible, setModalVisible] = useState(false)
      visible = modalVisible
      const currentCreation = useMobileBrowserTabCreation({
        client,
        connState: 'connected',
        hostId: 'host-a',
        worktreeId,
        browserScreencastSupportedRef: { current: true },
        pendingBrowserFocusPageIdRef: { current: null },
        fetchSessionTabs: vi.fn(),
        fetchPendingBrowserSessionTabs: vi.fn(),
        scheduleDelayedAction: vi.fn(),
        setCreateError: vi.fn(),
        showToast: vi.fn(),
        setShowCreateBrowserModal: setModalVisible
      })
      creation = currentCreation
      return createElement(TextInputModal, {
        visible: modalVisible,
        title: 'New Browser',
        allowEmpty: true,
        onSubmit: (value) => void currentCreation.submitBrowserUrl(value),
        onCancel: currentCreation.cancelBrowserDialog
      })
    }

    act(() => {
      renderer = create(createElement(Harness, { worktreeId: 'wt-a' }))
    })
    return {
      sendRequest,
      open: () => act(() => creation.openBrowserDialog()),
      input: () => renderer!.root.findByType('TextInput'),
      cancel: () => renderer!.root.findAllByType('Pressable')[0]!.props.onPress as () => void,
      submit: () => renderer!.root.findAllByType('Pressable')[1]!.props.onPress as () => void,
      switchWorktree: (worktreeId: string) =>
        act(() => renderer!.update(createElement(Harness, { worktreeId }))),
      createDirect: (url: string) => creation.handleCreateBrowser(url),
      isVisible: () => visible
    }
  }

  it('does not create from a queued submit after Cancel while the input is still mounted', async () => {
    const dialog = mountDialog()
    dialog.open()
    const input = dialog.input
    act(() => input().props.onChangeText('https://a.example'))
    const queuedSubmit = input().props.onSubmitEditing as () => void
    act(() => dialog.cancel()())
    expect(dialog.isVisible()).toBe(false)
    expect(renderer!.root.findAllByType('TextInput')).toHaveLength(1)
    await act(async () => {
      queuedSubmit()
      await Promise.resolve()
    })
    expect(dialog.sendRequest).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'submit'] as const)(
    'ignores the previous dialog %s after Cancel and reopen, while the new dialog can submit',
    async (oldAction) => {
      const dialog = mountDialog()
      dialog.open()
      act(() => dialog.input().props.onChangeText('https://old.example'))
      const oldSubmit = dialog.input().props.onSubmitEditing as () => void
      const oldCancel = dialog.cancel()
      act(() => dialog.cancel()())
      dialog.open()
      expect(dialog.isVisible()).toBe(true)
      await act(async () => {
        if (oldAction === 'cancel') {
          oldCancel()
        } else {
          oldSubmit()
        }
        await Promise.resolve()
      })
      expect(dialog.isVisible()).toBe(true)
      expect(dialog.sendRequest).not.toHaveBeenCalled()

      act(() => dialog.input().props.onChangeText('https://new.example'))
      await act(async () => {
        dialog.submit()()
        await Promise.resolve()
      })
      expect(dialog.sendRequest).toHaveBeenCalledOnce()
      expect(dialog.sendRequest).toHaveBeenCalledWith(
        'browser.tabCreate',
        { worktree: 'id:wt-a', url: 'https://new.example/', activate: true },
        { timeoutMs: 30_000 }
      )
      expect(dialog.isVisible()).toBe(false)
    }
  )

  it('closes the old source dialog while direct URL creation remains available on the new source', async () => {
    const dialog = mountDialog()
    dialog.open()
    act(() => dialog.input().props.onChangeText('https://old.example'))
    const oldSubmit = dialog.input().props.onSubmitEditing as () => void
    dialog.switchWorktree('wt-b')
    expect(dialog.isVisible()).toBe(false)
    await act(async () => {
      oldSubmit()
      await Promise.resolve()
    })
    expect(dialog.sendRequest).not.toHaveBeenCalled()

    await act(async () => {
      expect(await dialog.createDirect('https://new.example')).toBe(true)
    })
    expect(dialog.sendRequest).toHaveBeenCalledOnce()
    expect(dialog.sendRequest).toHaveBeenCalledWith(
      'browser.tabCreate',
      { worktree: 'id:wt-b', url: 'https://new.example/', activate: true },
      { timeoutMs: 30_000 }
    )
  })
})
