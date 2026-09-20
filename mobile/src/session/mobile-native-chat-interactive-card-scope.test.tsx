import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView'
}))
vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  CircleHelp: 'CircleHelp',
  ShieldQuestion: 'ShieldQuestion',
  Square: 'Square'
}))
vi.mock('./use-mobile-native-chat-pinch-gesture', () => ({
  useMobileNativeChatPinchGesture: () => ({ fontScale: 1, pinchGesture: null })
}))
vi.mock('../components/platform-safe-gesture-detector', () => ({
  PlatformSafeGestureDetector: 'GestureDetector'
}))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileAgentWorkingIndicator', () => ({ MobileAgentWorkingIndicator: 'Working' }))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))

type ViewProps = Parameters<typeof MobileNativeChatView>[0]

describe('MobileNativeChatView interactive card scope', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function element(scopeKey: string, overrides: Partial<ViewProps>) {
    const props = {
      messages: [],
      folded: [],
      status: 'ready' as const,
      streaming: null,
      onSend: vi.fn(async () => true),
      pending: [],
      composerText: '',
      onComposerTextChange: vi.fn(),
      interactionScopeKey: scopeKey,
      ...overrides
    }
    return createElement(MobileNativeChatView, props)
  }

  async function render(scopeKey: string, overrides: Partial<ViewProps>): Promise<void> {
    await act(async () => {
      renderer = create(element(scopeKey, overrides))
    })
  }

  async function update(scopeKey: string, overrides: Partial<ViewProps>): Promise<void> {
    await act(async () => {
      renderer?.update(element(scopeKey, overrides))
    })
  }

  function pressable(label: string) {
    return renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.findAllByType('Text').some((text) => text.children.join('') === label))!
  }

  it('does not carry A permission pending state into B with the same prompt', async () => {
    let resolveA!: (accepted: boolean) => void
    const responseA = new Promise<boolean>((resolve) => {
      resolveA = resolve
    })
    const onA = vi.fn(() => responseA)
    const onB = vi.fn(async () => true)
    const permission = { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] }
    await render('terminal-A', { permission, onRespondPermission: onA })
    let pendingA!: Promise<void>
    act(() => {
      pendingA = pressable('Allow').props.onPress()
    })
    expect(onA).toHaveBeenCalledWith('1')

    await update('terminal-B', { permission, onRespondPermission: onB })
    await act(async () => {
      resolveA(true)
      await pendingA
    })
    expect(pressable('Allow').props.disabled).toBe(false)
    await act(async () => {
      await pressable('Allow').props.onPress()
    })
    expect(onB).toHaveBeenCalledWith('1')
  })

  it('retains a question draft on the same terminal but clears it for another', async () => {
    const question = { question: 'Continue?', options: [], optionTokens: [], multiSelect: false }
    await render('terminal-A', { question })
    act(() => renderer!.root.findByType('TextInput').props.onChangeText('A answer'))
    await update('terminal-A', { question })
    expect(renderer!.root.findByType('TextInput').props.value).toBe('A answer')

    await update('terminal-B', { question })
    expect(renderer!.root.findByType('TextInput').props.value).toBe('')
  })

  it('unlocks a new permission request with identical content on the same terminal', async () => {
    const permission = { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] }
    const onRespondPermission = vi.fn(async () => true)
    const requestA = { permission, onRespondPermission, interactionRequestKey: 'request-a' }
    await render('terminal-A', requestA)
    await act(async () => {
      await pressable('Allow').props.onPress()
    })
    await update('terminal-A', requestA)
    expect(pressable('Allow').props.disabled).toBe(true)

    await update('terminal-A', { ...requestA, interactionRequestKey: 'request-b' })
    expect(pressable('Allow').props.disabled).toBe(false)
    await act(async () => {
      await pressable('Allow').props.onPress()
    })
    expect(onRespondPermission).toHaveBeenCalledTimes(2)
  })

  it('keeps a new identical permission request usable when the prior response arrives late', async () => {
    let resolveA!: (accepted: boolean) => void
    const responseA = new Promise<boolean>((resolve) => {
      resolveA = resolve
    })
    const permission = { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] }
    await render('terminal-A', {
      permission,
      onRespondPermission: () => responseA,
      interactionRequestKey: 'request-a'
    })
    let pendingA!: Promise<void>
    act(() => {
      pendingA = pressable('Allow').props.onPress()
    })
    await update('terminal-A', {
      permission,
      interactionRequestKey: 'request-b'
    })
    await act(async () => {
      resolveA(true)
      await pendingA
    })
    expect(pressable('Allow').props.disabled).toBe(false)
  })

  it.each([
    ['request-a', undefined],
    [undefined, 'request-a']
  ])(
    'keeps a submitted permission when optional identity changes from %s to %s',
    async (before, after) => {
      const permission = { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] }
      const props = { permission, onRespondPermission: vi.fn(async () => true) }
      await render('terminal-A', { ...props, interactionRequestKey: before })
      await act(async () => {
        await pressable('Allow').props.onPress()
      })
      await update('terminal-A', { ...props, interactionRequestKey: after })
      expect(pressable('Allow').props.disabled).toBe(true)

      await update('terminal-A', { ...props, interactionRequestKey: 'request-b' })
      expect(pressable('Allow').props.disabled).toBe(false)
    }
  )

  it('retains an ask step on the same terminal but resets it for another', async () => {
    const ask = {
      questions: [
        { question: 'First?', multiSelect: false, options: [{ label: 'Yes' }] },
        { question: 'Second?', multiSelect: false, options: [{ label: 'No' }] }
      ]
    }
    const props = { ask, askKey: 'same-ask' }
    await render('terminal-A', props)
    act(() => pressable('Yes').props.onPress())
    await act(async () => {
      await pressable('Next').props.onPress()
    })
    expect(
      renderer!.root.findAllByType('Text').some((text) => text.children.join('') === '2/2')
    ).toBe(true)
    await update('terminal-A', props)
    expect(
      renderer!.root.findAllByType('Text').some((text) => text.children.join('') === '2/2')
    ).toBe(true)

    await update('terminal-B', props)
    expect(
      renderer!.root.findAllByType('Text').some((text) => text.children.join('') === '1/2')
    ).toBe(true)
  })
})
