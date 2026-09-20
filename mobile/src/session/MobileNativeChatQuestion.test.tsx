import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatQuestion } from './MobileNativeChatQuestion'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CircleHelp: 'CircleHelp'
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MobileNativeChatQuestion free-text answer', () => {
  let renderer: ReactTestRenderer | null = null
  const question = { question: 'Continue?', options: [], optionTokens: [], multiSelect: false }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(onAnswer: (text: string) => Promise<boolean>): Promise<void> {
    await act(async () => {
      renderer = create(createElement(MobileNativeChatQuestion, { question, onAnswer }))
    })
  }

  function text(): string {
    return renderer!.root.findByType('TextInput').props.value
  }

  function edit(next: string): void {
    act(() => renderer!.root.findByType('TextInput').props.onChangeText(next))
  }

  function submit(): Promise<void> {
    return renderer!.root.findByProps({ accessibilityLabel: 'Send reply' }).props.onPress()
  }

  it('keeps new input typed while an earlier accepted answer is pending', async () => {
    const pending = deferred<boolean>()
    const onAnswer = vi.fn(() => pending.promise)
    await render(onAnswer)
    edit('first')
    let first!: Promise<void>
    act(() => {
      first = submit()
    })
    expect(onAnswer).toHaveBeenCalledWith('first')
    edit('second')
    await act(async () => {
      pending.resolve(true)
      await first
    })
    expect(text()).toBe('second')
  })

  it('keeps an edited draft even when it returns to the submitted text', async () => {
    const pending = deferred<boolean>()
    await render(() => pending.promise)
    edit('same')
    let first!: Promise<void>
    act(() => {
      first = submit()
    })
    edit('changed')
    edit('same')
    await act(async () => {
      pending.resolve(true)
      await first
    })
    expect(text()).toBe('same')
  })

  it('clears an unchanged draft on success and retains it on rejection', async () => {
    const onAnswer = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await render(onAnswer)
    edit('retry me')
    await act(async () => {
      await submit()
    })
    expect(text()).toBe('retry me')
    await act(async () => {
      await submit()
    })
    expect(text()).toBe('')
    expect(onAnswer).toHaveBeenCalledTimes(2)
  })
})
