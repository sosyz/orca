import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileDocState, MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'
import { RetainedSessionDocumentSurfaces } from './RetainedSessionDocumentSurfaces'

vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children?: unknown }) => createElement('View', props, children)
}))

const lifecycle = vi.hoisted(() => ({
  fileMounts: 0,
  fileUnmounts: 0,
  markdownMounts: 0,
  markdownUnmounts: 0
}))

vi.mock('./MobileMarkdownReader', async () => {
  const React = await import('react')
  return {
    MobileMarkdownReader: (props: Record<string, unknown>) => {
      React.useEffect(() => {
        lifecycle.markdownMounts += 1
        return () => {
          lifecycle.markdownUnmounts += 1
        }
      }, [])
      return createElement('MobileMarkdownReader', props)
    }
  }
})

vi.mock('./MobileSessionFileReader', async () => {
  const React = await import('react')
  return {
    MobileSessionFileReader: (props: Record<string, unknown>) => {
      React.useEffect(() => {
        lifecycle.fileMounts += 1
        return () => {
          lifecycle.fileUnmounts += 1
        }
      }, [])
      return createElement('MobileSessionFileReader', props)
    }
  }
})

const markdownTab: Extract<MobileSessionTab, { type: 'markdown' }> = {
  type: 'markdown',
  documentVersion: '1',
  filePath: '/repo/README.md',
  id: 'md-1',
  isActive: true,
  relativePath: 'README.md',
  title: 'README.md'
}
const fileTab: Extract<MobileSessionTab, { type: 'file' }> = {
  type: 'file',
  id: 'file-1',
  isActive: false,
  isDirty: false,
  language: 'typescript',
  relativePath: 'src/App.tsx',
  title: 'App.tsx'
}
const markdownDoc: MarkdownDocState = {
  status: 'ready',
  baseVersion: '1',
  content: '# Title',
  editable: true,
  isDirty: false,
  localContent: '# Title'
}
const fileDoc: FileDocState = {
  status: 'ready',
  byteLength: 5,
  content: 'hello',
  kind: 'file',
  truncated: false
}

const callbacks = {
  onFileRefresh: vi.fn(),
  onMarkdownChange: vi.fn(),
  onMarkdownCopy: vi.fn(),
  onMarkdownDiscard: vi.fn(),
  onMarkdownRefresh: vi.fn(),
  onMarkdownSave: vi.fn(),
  resolveDiffCommentActions: vi.fn(() => undefined)
}

function host(activeTab: typeof markdownTab | typeof fileTab | null, tabs: MobileSessionTab[]) {
  return createElement(RetainedSessionDocumentSurfaces, {
    ...callbacks,
    activeTab,
    fileDocs: new Map([['file-1', fileDoc]]),
    frameStyle: { flex: 1 },
    hiddenFrameStyle: { display: 'none' },
    keyboardLift: 0,
    markdownDocs: new Map([['md-1', markdownDoc]]),
    tabs,
    toast: createElement('Toast')
  })
}

function markdownReaders(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('MobileMarkdownReader')
}

function fileReaders(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('MobileSessionFileReader')
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  lifecycle.fileMounts = 0
  lifecycle.fileUnmounts = 0
  lifecycle.markdownMounts = 0
  lifecycle.markdownUnmounts = 0
  vi.clearAllMocks()
})

describe('RetainedSessionDocumentSurfaces', () => {
  it('retains visited Markdown and file readers while switching active tabs', () => {
    const tabs = [markdownTab, fileTab]
    act(() => {
      renderer = create(host(markdownTab, tabs))
    })
    act(() => {
      renderer?.update(host(fileTab, tabs))
    })

    expect(markdownReaders(renderer!)[0]?.props.active).toBe(false)
    expect(fileReaders(renderer!)[0]?.props.active).toBe(true)
    expect(lifecycle.markdownMounts).toBe(1)
    expect(lifecycle.fileMounts).toBe(1)
    expect(lifecycle.markdownUnmounts).toBe(0)

    act(() => {
      markdownReaders(renderer!)[0]?.props.onChange('edited')
    })
    expect(callbacks.onMarkdownChange).toHaveBeenCalledWith(markdownTab, 'edited')
  })

  it('unmounts a retained reader only after its tab leaves the live tab list', () => {
    act(() => {
      renderer = create(host(markdownTab, [markdownTab, fileTab]))
    })
    act(() => {
      renderer?.update(host(fileTab, [markdownTab, fileTab]))
    })
    act(() => {
      renderer?.update(host(fileTab, [fileTab]))
    })

    expect(markdownReaders(renderer!)).toHaveLength(0)
    expect(fileReaders(renderer!)).toHaveLength(1)
    expect(lifecycle.markdownUnmounts).toBe(1)
    expect(lifecycle.fileUnmounts).toBe(0)
  })
})
