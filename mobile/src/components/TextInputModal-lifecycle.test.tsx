import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextInputModal } from './TextInputModal'

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
vi.mock('./mounted-bottom-drawer', () => ({
  MountedBottomDrawer: ({ children }: { children: React.ReactNode }) => children
}))

describe('TextInputModal opening identity', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(defaultValue = 'initial', allowEmpty = false) {
    const onSubmit = vi.fn()
    let visible = true
    let setVisible!: (next: boolean) => void
    let setDefaultValue!: (next: string) => void
    function Harness() {
      const [currentVisible, updateVisible] = useState(true)
      const [currentDefault, updateDefault] = useState(defaultValue)
      visible = currentVisible
      setVisible = updateVisible
      setDefaultValue = updateDefault
      return createElement(TextInputModal, {
        visible: currentVisible,
        title: 'Rename',
        defaultValue: currentDefault,
        allowEmpty,
        onSubmit,
        onCancel: () => updateVisible(false)
      })
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    return {
      onSubmit,
      input: () => renderer!.root.findByType('TextInput'),
      cancel: () => renderer!.root.findAllByType('Pressable')[0]!.props.onPress as () => void,
      submit: () => renderer!.root.findAllByType('Pressable')[1]!.props.onPress as () => void,
      setVisible: (next: boolean) => setVisible(next),
      setDefaultValue: (next: string) => setDefaultValue(next),
      isVisible: () => visible
    }
  }

  it('retires old submit and cancel callbacks after a separate close and reopen', () => {
    const modal = mount()
    act(() => modal.input().props.onChangeText('old'))
    const oldSubmit = modal.input().props.onSubmitEditing as () => void
    const oldCancel = modal.cancel()
    act(() => modal.cancel()())
    expect(modal.input().props.value).toBe('old')
    act(() => modal.setVisible(true))
    expect(modal.isVisible()).toBe(true)
    expect(modal.input().props.value).toBe('initial')
    act(() => {
      oldSubmit()
      oldCancel()
    })
    expect(modal.isVisible()).toBe(true)
    expect(modal.input().props.value).toBe('initial')
    expect(modal.onSubmit).not.toHaveBeenCalled()
    act(() => modal.input().props.onChangeText('new'))
    act(() => modal.submit()())
    expect(modal.onSubmit).toHaveBeenCalledExactlyOnceWith('new')
  })

  it('rearms after Cancel and reopen are batched into one render', () => {
    const modal = mount()
    act(() => modal.input().props.onChangeText('old'))
    const oldSubmit = modal.input().props.onSubmitEditing as () => void
    act(() => {
      modal.cancel()()
      modal.setVisible(true)
    })
    expect(modal.isVisible()).toBe(true)
    act(() => oldSubmit())
    expect(modal.onSubmit).not.toHaveBeenCalled()
    act(() => modal.input().props.onChangeText('new'))
    act(() => modal.submit()())
    expect(modal.onSubmit).toHaveBeenCalledExactlyOnceWith('new')
  })

  it('keeps ordinary edits live and retires an old callback when defaultValue changes', () => {
    const modal = mount('A')
    act(() => modal.input().props.onChangeText('user edit'))
    const oldSubmit = modal.input().props.onSubmitEditing as () => void
    act(() => modal.setDefaultValue('B'))
    expect(modal.input().props.value).toBe('B')
    act(() => oldSubmit())
    expect(modal.onSubmit).not.toHaveBeenCalled()
    act(() => modal.submit()())
    expect(modal.onSubmit).toHaveBeenCalledExactlyOnceWith('B')
  })

  it('preserves allowEmpty and leaves repeated submits to the caller', () => {
    const modal = mount('', true)
    act(() => {
      modal.submit()()
      modal.submit()()
    })
    expect(modal.onSubmit).toHaveBeenCalledTimes(2)
    expect(modal.onSubmit).toHaveBeenNthCalledWith(1, '')
    expect(modal.onSubmit).toHaveBeenNthCalledWith(2, '')
  })
})
