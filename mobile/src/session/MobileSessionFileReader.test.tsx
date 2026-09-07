import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function reader(doc: FileDocState) {
  return createElement(MobileSessionFileReader, {
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

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.syntaxSegments = []
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
})
