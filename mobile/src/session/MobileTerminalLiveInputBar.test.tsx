import { createElement, useCallback, useRef, useState, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLiveInputSender } from '../terminal/terminal-live-input-sender'
import { useTerminalLiveInputCommit } from '../terminal/use-terminal-live-input-commit'
import {
  MobileTerminalLiveInputBar,
  type MobileTerminalLiveInputBarHandle
} from './MobileTerminalLiveInputBar'

const mockTextInputHandle = {
  blur: vi.fn(),
  focus: vi.fn(),
  setNativeProps: vi.fn()
}

vi.mock('react-native', async () => {
  const React = await import('react')
  const MockTextInput = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => mockTextInputHandle)
    return React.createElement('TextInput', props)
  })
  MockTextInput.displayName = 'TextInput'
  return {
    ActivityIndicator: 'ActivityIndicator',
    Platform: {
      OS: 'harmony',
      select: (options: Record<string, unknown>) => options.harmony ?? options.default
    },
    Pressable: 'Pressable',
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1
    },
    Text: 'Text',
    TextInput: MockTextInput,
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({
  ImagePlus: 'ImagePlus',
  Keyboard: 'Keyboard',
  Mic: 'Mic'
}))

type SentInput = {
  readonly handle: string
  readonly bytes: string
}

type LiveInputBarHarness = {
  readonly inputRef: RefObject<TextInput | null>
  readonly parentRenderCount: () => number
  readonly renderer: ReactTestRenderer
  readonly sent: readonly SentInput[]
  readonly setActiveHandle: (handle: string) => void
  readonly unmount: () => void
}

function createLiveInputBarHarness(): LiveInputBarHarness {
  const activeHandleRef: RefObject<string | null> = { current: 'terminal-a' }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const inputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandles = new Set(['terminal-a', 'terminal-b'])
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: liveInputTerminalHandles
  }
  const sent: SentInput[] = []
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (handle, bytes) => {
      sent.push({ handle, bytes })
      return true
    }
  }
  let parentRenderCount = 0
  let setActiveHandleState: (handle: string) => void = () => {}
  let renderer: ReactTestRenderer | null = null

  function Parent(): JSX.Element {
    parentRenderCount += 1
    const [activeHandle, setActiveHandle] = useState('terminal-a')
    const barRef = useRef<MobileTerminalLiveInputBarHandle>(null)
    setActiveHandleState = setActiveHandle
    activeHandleRef.current = activeHandle
    const setLiveInputCapture = useCallback((text: string) => {
      barRef.current?.setCaptureText(text)
    }, [])
    const { handleLiveInputChange, handleLiveInputKeyPress, handleLiveInputSubmit } =
      useTerminalLiveInputCommit({
        activeHandle,
        activeHandleRef,
        activeSessionTabType: 'terminal',
        activeSessionTabTypeRef,
        connected: true,
        liveInputRef: inputRef,
        liveInputTerminalHandles,
        liveInputTerminalHandlesRef,
        sendLiveTerminalInputRef,
        setLiveInputCapture
      })

    return createElement(MobileTerminalLiveInputBar, {
      ref: barRef,
      canSend: true,
      dictation: { isProcessing: false, isRecording: false, isStarting: false },
      dictationMode: 'toggle',
      inputRef,
      isAttaching: false,
      onAttachFile: vi.fn(),
      onAttachImage: vi.fn(),
      onChange: handleLiveInputChange,
      onDictationCancel: vi.fn(),
      onDictationPressIn: vi.fn(),
      onDictationPressOut: vi.fn(),
      onDictationToggle: vi.fn(),
      onFocusLiveInput: vi.fn(),
      onKeyPress: handleLiveInputKeyPress,
      onSubmitEditing: handleLiveInputSubmit
    })
  }

  act(() => {
    renderer = create(createElement(Parent))
  })
  if (!renderer) {
    throw new Error('live input bar harness did not render')
  }

  return {
    inputRef,
    parentRenderCount: () => parentRenderCount,
    renderer,
    sent,
    setActiveHandle: (handle: string) => {
      act(() => setActiveHandleState(handle))
    },
    unmount: () => act(() => renderer?.unmount())
  }
}

function findTextInput(renderer: ReactTestRenderer): {
  readonly props: {
    readonly onChange: (event: { nativeEvent: { text: string; isComposing?: boolean } }) => void
    readonly onSubmitEditing: () => void
    readonly value: string
  }
} {
  return renderer.root.findByType('TextInput') as ReturnType<typeof findTextInput>
}

function textValues(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
}

async function changeLiveInput(
  renderer: ReactTestRenderer,
  text: string,
  isComposing?: boolean
): Promise<void> {
  await act(async () => {
    findTextInput(renderer).props.onChange({ nativeEvent: { text, isComposing } })
  })
}

describe('MobileTerminalLiveInputBar', () => {
  afterEach(() => {
    mockTextInputHandle.blur.mockClear()
    mockTextInputHandle.focus.mockClear()
    mockTextInputHandle.setNativeProps.mockClear()
  })

  it('updates the visible capture locally without re-rendering the route owner', async () => {
    const harness = createLiveInputBarHarness()
    const rendersAfterMount = harness.parentRenderCount()

    await changeLiveInput(harness.renderer, 'a')
    await changeLiveInput(harness.renderer, 'ab')

    expect(harness.parentRenderCount()).toBe(rendersAfterMount)
    expect(findTextInput(harness.renderer).props.value).toBe('ab')
    expect(textValues(harness.renderer)).toContain('ab')
    await vi.waitFor(() =>
      expect(harness.sent).toEqual([
        { handle: 'terminal-a', bytes: 'a' },
        { handle: 'terminal-a', bytes: 'b' }
      ])
    )
    harness.unmount()
  })

  it('keeps the raw field text visible while sending normalized terminal bytes', async () => {
    const harness = createLiveInputBarHarness()

    await changeLiveInput(harness.renderer, 'a–')

    expect(findTextInput(harness.renderer).props.value).toBe('a–')
    expect(textValues(harness.renderer)).toContain('a–')
    await vi.waitFor(() => expect(harness.sent).toEqual([{ handle: 'terminal-a', bytes: 'a--' }]))
    harness.unmount()
  })

  it('clears the local capture when the active terminal changes before typing on the next one', async () => {
    const harness = createLiveInputBarHarness()
    await changeLiveInput(harness.renderer, 'a')
    await vi.waitFor(() => expect(harness.sent).toEqual([{ handle: 'terminal-a', bytes: 'a' }]))

    harness.setActiveHandle('terminal-b')

    expect(findTextInput(harness.renderer).props.value).toBe('')
    expect(textValues(harness.renderer)).toContain('Tap to show keyboard')
    await changeLiveInput(harness.renderer, 'b')
    await vi.waitFor(() =>
      expect(harness.sent).toEqual([
        { handle: 'terminal-a', bytes: 'a' },
        { handle: 'terminal-b', bytes: 'b' }
      ])
    )
    harness.unmount()
  })

  it('clears the local capture after submitting the live field', async () => {
    const harness = createLiveInputBarHarness()
    await changeLiveInput(harness.renderer, 'p')
    await vi.waitFor(() => expect(harness.sent).toEqual([{ handle: 'terminal-a', bytes: 'p' }]))

    await act(async () => {
      findTextInput(harness.renderer).props.onSubmitEditing()
    })

    await vi.waitFor(() => expect(findTextInput(harness.renderer).props.value).toBe(''))
    expect(harness.sent).toEqual([
      { handle: 'terminal-a', bytes: 'p' },
      { handle: 'terminal-a', bytes: '\r' }
    ])
    harness.unmount()
  })

  it('keeps the native input ref live only while the bar is mounted', () => {
    const harness = createLiveInputBarHarness()
    expect(harness.inputRef.current).toBe(mockTextInputHandle)

    harness.unmount()

    expect(harness.inputRef.current).toBeNull()
  })
})
