import { createElement, forwardRef, useImperativeHandle } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n/i18n'
import { MobileMarkdownReader } from './MobileMarkdownReader'
import type { MarkdownDocState } from './mobile-session-route-types'

const mocks = vi.hoisted(() => ({
  dismissKeyboard: vi.fn(),
  reportKeyboardInset: null as ((bottom: number) => void) | null
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'ios', select: (choices: Record<string, unknown>) => choices.ios },
    Pressable: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('Pressable', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  Keyboard: 'KeyboardIcon',
  RefreshCw: 'RefreshCw'
}))

vi.mock('../components/MobileRichMarkdownEditor', () => {
  const Editor = forwardRef(
    (props: { onKeyboardInsetChange?: (bottom: number) => void }, ref: unknown) => {
      mocks.reportKeyboardInset = props.onKeyboardInsetChange ?? null
      useImperativeHandle(ref as never, () => ({ dismissKeyboard: mocks.dismissKeyboard }))
      return createElement('MobileRichMarkdownEditor', props)
    }
  )
  return { MobileRichMarkdownEditor: Editor }
})

const readyDoc: MarkdownDocState = {
  status: 'ready',
  content: '# Notes',
  localContent: '# Notes',
  baseVersion: '1',
  isDirty: false,
  editable: true
}

describe('MobileMarkdownReader', () => {
  let renderer: ReactTestRenderer | null = null

  function render(
    keyboardLift: number,
    doc: MarkdownDocState = readyDoc,
    active = true
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(MobileMarkdownReader, {
          active,
          documentId: 'doc-1',
          doc,
          keyboardLift,
          onRefresh: vi.fn(),
          onChange: vi.fn(),
          onSave: vi.fn(),
          onCopy: vi.fn(),
          onDiscard: vi.fn()
        })
      )
    })
    return renderer as unknown as ReactTestRenderer
  }

  function dismissButtons(instance: ReactTestRenderer) {
    return instance.root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props?.accessibilityLabel === 'Dismiss keyboard'
    )
  }

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    mocks.reportKeyboardInset = null
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
  })

  it('offers keyboard dismissal while the keyboard covers the editor', () => {
    const instance = render(291)

    const [button] = dismissButtons(instance)
    expect(button).toBeDefined()

    act(() => button.props.onPress())

    expect(mocks.dismissKeyboard).toHaveBeenCalledOnce()
  })

  it('hides the floating row entirely on a clean document with the keyboard closed', () => {
    const instance = render(0)

    expect(dismissButtons(instance)).toHaveLength(0)
    expect(instance.root.findAllByType('Text')).toHaveLength(0)
  })

  it('keeps document actions available without offering dismissal when the keyboard is closed', () => {
    const instance = render(0, { ...readyDoc, isDirty: true })

    expect(dismissButtons(instance)).toHaveLength(0)
    expect(instance.root.findAllByType('Text').length).toBeGreaterThan(0)
  })

  it('treats a WebView-reported inset as an open keyboard when native lift reports none', () => {
    const instance = render(0)
    expect(dismissButtons(instance)).toHaveLength(0)

    act(() => mocks.reportKeyboardInset?.(291))

    expect(dismissButtons(instance)).toHaveLength(1)
  })

  it('renders markdown actions in the active mobile language', async () => {
    await i18n.changeLanguage('zh')

    const instance = render(291, {
      ...readyDoc,
      isDirty: true,
      stale: true
    })

    const text = instance.root
      .findAllByType('Text')
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
    const labels = instance.root
      .findAllByType('Pressable')
      .map((node) => node.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string')
    expect(text).toEqual(expect.arrayContaining(['桌面端已更改', '放弃', '保存']))
    expect(labels).toContain('收起键盘')
  })

  it('dismisses and disables the editor while retained offscreen', () => {
    const instance = render(291, readyDoc)
    expect(instance.root.findByType('MobileRichMarkdownEditor').props.editable).toBe(true)

    act(() => {
      instance.update(
        createElement(MobileMarkdownReader, {
          active: false,
          documentId: 'doc-1',
          doc: readyDoc,
          keyboardLift: 291,
          onChange: vi.fn(),
          onCopy: vi.fn(),
          onDiscard: vi.fn(),
          onRefresh: vi.fn(),
          onSave: vi.fn()
        })
      )
    })

    expect(mocks.dismissKeyboard).toHaveBeenCalledOnce()
    expect(instance.root.findByType('MobileRichMarkdownEditor').props.editable).toBe(false)
    expect(dismissButtons(instance)).toHaveLength(0)
  })

  it('does not reuse a stale WebView keyboard inset after tab reactivation', () => {
    const instance = render(0)

    act(() => mocks.reportKeyboardInset?.(291))
    expect(dismissButtons(instance)).toHaveLength(1)

    act(() => {
      instance.update(
        createElement(MobileMarkdownReader, {
          active: false,
          documentId: 'doc-1',
          doc: readyDoc,
          keyboardLift: 0,
          onChange: vi.fn(),
          onCopy: vi.fn(),
          onDiscard: vi.fn(),
          onRefresh: vi.fn(),
          onSave: vi.fn()
        })
      )
    })
    act(() => {
      instance.update(
        createElement(MobileMarkdownReader, {
          active: true,
          documentId: 'doc-1',
          doc: readyDoc,
          keyboardLift: 0,
          onChange: vi.fn(),
          onCopy: vi.fn(),
          onDiscard: vi.fn(),
          onRefresh: vi.fn(),
          onSave: vi.fn()
        })
      )
    })

    expect(dismissButtons(instance)).toHaveLength(0)
  })
})
