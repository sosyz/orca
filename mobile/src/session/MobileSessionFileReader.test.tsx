import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n/i18n'
import { MobileSessionFileReader } from './MobileSessionFileReader'
import { highlightMobileCode } from './mobile-file-syntax'
import type { FileDocState } from './mobile-session-route-types'

const mocks = vi.hoisted(() => ({
  syntaxSegments: [] as Array<Array<{ text: string; kind: string }>>,
  zoomOut: vi.fn(),
  zoomIn: vi.fn(),
  resetZoom: vi.fn()
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Platform: { OS: 'ios', select: (choices: Record<string, unknown>) => choices.ios },
    Pressable: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Pressable', props, children),
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Text', props, children),
    TextInput: 'TextInput',
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children)
  }
})

vi.mock('lucide-react-native', () => ({
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Plus: 'Plus',
  Send: 'Send',
  X: 'X'
}))

vi.mock('../files/MobileCodeScaleControls', () => ({
  MobileCodeScaleControls: 'MobileCodeScaleControls'
}))

vi.mock('../files/use-mobile-code-text-scale', () => ({
  useMobileCodeTextScale: () => ({
    textScale: 1,
    panHandlers: {},
    zoomOut: mocks.zoomOut,
    zoomIn: mocks.zoomIn,
    resetZoom: mocks.resetZoom
  })
}))

vi.mock('../components/MobileHtmlPreview', () => ({
  MobileHtmlPreview: ({ renderSource }: { html: string; renderSource: () => ReactNode }) =>
    createElement('MobileHtmlPreview', null, renderSource())
}))

vi.mock('../components/MobileSyntaxSegments', () => ({
  MobileSyntaxSegments: (props: { segments: Array<{ text: string; kind: string }> }) => {
    mocks.syntaxSegments.push(props.segments)
    return createElement('MobileSyntaxSegments', props)
  }
}))

vi.mock('./mobile-file-syntax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-file-syntax')>()
  return {
    ...actual,
    highlightMobileCode: vi.fn(actual.highlightMobileCode)
  }
})

const fileDoc: FileDocState = {
  status: 'ready',
  kind: 'file',
  content: 'const label: string = "Orca"',
  truncated: false,
  byteLength: 28
}

const secondFileDoc: FileDocState = {
  status: 'ready',
  kind: 'file',
  content: 'const second: string = "Tab"',
  truncated: false,
  byteLength: 27
}

const imageDoc: FileDocState = {
  status: 'ready',
  kind: 'image',
  dataUri: 'data:image/png;base64,AA=='
}

const diffDoc: FileDocState = {
  status: 'ready',
  kind: 'diff',
  truncated: false,
  lines: [{ kind: 'add', text: 'const diffed = true', newLineNumber: 1 }]
}

function reader(
  doc: FileDocState,
  props: Partial<{
    active: boolean
    diffCommentActions: NonNullable<
      Parameters<typeof MobileSessionFileReader>[0]['diffCommentActions']
    >
    onRefresh: () => void
  }> = {}
) {
  return createElement(MobileSessionFileReader, {
    ...props,
    doc,
    title: 'App.ts',
    relativePath: 'src/App.ts',
    language: 'typescript'
  })
}

function lastSegments() {
  return mocks.syntaxSegments.at(-1) ?? []
}

describe('MobileSessionFileReader syntax lifecycle', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.syntaxSegments = []
    await i18n.changeLanguage('en')
  })

  it.each([
    ['image', imageDoc],
    ['loading', { status: 'loading' } satisfies FileDocState],
    ['diff', diffDoc]
  ])('drops highlighted file syntax after switching through %s', (_label, intermediateDoc) => {
    act(() => {
      renderer = create(reader(fileDoc))
    })
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(lastSegments()).not.toEqual([{ text: fileDoc.content, kind: 'plain' }])

    act(() => {
      renderer?.update(reader(intermediateDoc))
    })
    act(() => {
      renderer?.update(reader(fileDoc))
    })

    expect(lastSegments()).toEqual([{ text: fileDoc.content, kind: 'plain' }])
  })

  it('does not publish syntax from a ready file whose highlight timer was cancelled', () => {
    const highlight = vi.mocked(highlightMobileCode)

    act(() => {
      renderer = create(reader(fileDoc))
    })
    act(() => {
      renderer?.update(reader(secondFileDoc))
    })
    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(highlight).toHaveBeenCalledOnce()
    expect(highlight.mock.calls[0]?.[0]).toBe(secondFileDoc.content)
    expect(
      lastSegments()
        .map((segment) => segment.text)
        .join('')
    ).toBe(secondFileDoc.content)
  })

  it('keeps old file content visible with a non-blocking refresh error and retry', () => {
    const onRefresh = vi.fn()
    act(() => {
      renderer = create(reader({ ...fileDoc, refreshError: 'Refresh failed' }, { onRefresh }))
    })

    expect(
      renderer.root.findAllByType('Text').some((node) => node.props.children === 'Refresh failed')
    ).toBe(true)
    expect(lastSegments()).toEqual([{ text: fileDoc.content, kind: 'plain' }])

    const retry = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.findAllByType('Text').some((text) => text.props.children === 'Retry'))
    act(() => retry?.props.onPress())

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('passes inactive state to diff rows so retained offscreen comments cannot focus', () => {
    act(() => {
      renderer = create(
        reader(diffDoc, {
          active: false,
          diffCommentActions: {
            busy: false,
            comments: [],
            onAdd: vi.fn(),
            onCopyAll: vi.fn(),
            onDelete: vi.fn(),
            onSendAll: vi.fn()
          }
        })
      )
    })

    const list = renderer.root.findByType('FlatList')
    const row = list.props.renderItem({ item: list.props.data[0], index: 0 })

    expect(row.props.active).toBe(false)
    expect(row.props.commentsBusy).toBe(true)
  })

  it('keeps notes disabled after a metadata error and exposes a separate retry', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    const onRefresh = vi.fn()
    act(() => {
      renderer = create(
        reader(diffDoc, {
          onRefresh,
          diffCommentActions: {
            comments: [],
            busy: true,
            loadError: 'Could not load review notes',
            onRetry,
            onAdd: vi.fn(),
            onCopyAll: vi.fn(),
            onDelete: vi.fn(),
            onSendAll: vi.fn()
          }
        })
      )
    })
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Could not load review notes')
    ).toBe(true)
    const list = renderer.root.findByType('FlatList')
    expect(list.props.renderItem({ item: list.props.data[0], index: 0 }).props.commentsBusy).toBe(
      true
    )
    const retry = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.findAllByType('Text').some((text) => text.props.children === 'Retry'))
    expect(retry?.props.disabled).toBe(false)
    act(() => retry?.props.onPress())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('renders review-note toolbar copy in Chinese', async () => {
    await i18n.changeLanguage('zh')

    act(() => {
      renderer = create(
        reader(diffDoc, {
          diffCommentActions: {
            busy: false,
            comments: [
              {
                body: 'first',
                createdAt: 1,
                filePath: 'src/App.ts',
                id: 'note-1',
                lineNumber: 1,
                side: 'modified',
                worktreeId: 'worktree-1'
              },
              {
                body: 'second',
                createdAt: 2,
                filePath: 'src/App.ts',
                id: 'note-2',
                lineNumber: 1,
                side: 'modified',
                worktreeId: 'worktree-1'
              }
            ],
            onAdd: vi.fn(),
            onCopyAll: vi.fn(),
            onDelete: vi.fn(),
            onSendAll: vi.fn()
          }
        })
      )
    })

    const text = renderer.root
      .findAllByType('Text')
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
    const labels = renderer.root
      .findAllByType('Pressable')
      .map((node) => node.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string')

    expect(text).toEqual(expect.arrayContaining(['2 条审阅备注', '复制', '发送']))
    expect(labels).toEqual(expect.arrayContaining(['复制审阅备注', '将审阅备注发送给 AI']))
  })
})
