import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n/i18n'
import { MobileSessionDiffLineRow } from './MobileSessionDiffLineRow'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Pressable: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Pressable', props, children),
    Platform: { OS: 'ios', select: (choices: Record<string, unknown>) => choices.ios },
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1
    },
    Text: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Text', props, children),
    TextInput: 'TextInput',
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children)
  }
})

vi.mock('lucide-react-native', () => ({
  MessageSquare: 'MessageSquare',
  Plus: 'Plus',
  X: 'X'
}))

vi.mock('../components/MobileSyntaxSegments', () => ({
  MobileSyntaxSegments: 'MobileSyntaxSegments'
}))

function row(active: boolean) {
  return createElement(MobileSessionDiffLineRow, {
    active,
    activeCommentLine: 7,
    codeTextMetrics: { fontSize: 14, lineHeight: 22 },
    commentDraft: 'draft',
    comments: [],
    commentsBusy: false,
    gutterTextMetrics: { fontSize: 12, lineHeight: 22, width: 42 },
    index: 0,
    line: {
      kind: 'add',
      newLineNumber: 7,
      segments: [{ kind: 'plain', text: 'added' }],
      text: 'added'
    },
    onCancelComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onDraftChange: vi.fn(),
    onStartComment: vi.fn(),
    onSubmitComment: vi.fn(),
    title: 'App.ts'
  })
}

let renderer: ReactTestRenderer | null = null

afterEach(async () => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('MobileSessionDiffLineRow', () => {
  it('does not focus or edit an offscreen retained comment composer', () => {
    act(() => {
      renderer = create(row(false))
    })

    const input = renderer.root.findByType('TextInput')
    expect(input.props.editable).toBe(false)
    expect(input.props.autoFocus).toBe(false)
  })

  it('keeps the visible comment composer interactive', () => {
    act(() => {
      renderer = create(row(true))
    })

    const input = renderer.root.findByType('TextInput')
    expect(input.props.editable).toBe(true)
    expect(input.props.autoFocus).toBe(true)
  })

  it('renders comment composer labels in Chinese', async () => {
    await i18n.changeLanguage('zh')

    act(() => {
      renderer = create(row(true))
    })

    const input = renderer.root.findByType('TextInput')
    const text = renderer.root
      .findAllByType('Text')
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
    const labels = renderer.root
      .findAllByType('Pressable')
      .map((node) => node.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string')

    expect(input.props.placeholder).toBe('添加审阅备注')
    expect(text).toEqual(expect.arrayContaining(['取消', '保存备注']))
    expect(labels).toContain('在第 7 行添加备注')
  })
})
