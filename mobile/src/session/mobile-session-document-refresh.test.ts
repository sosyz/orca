import { createElement, forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { FileDocState, MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'
import {
  applyFileTabReadFailure,
  applyFileTabReadSuccess,
  applyMarkdownDiskFallbackReadSuccess,
  applyMarkdownTabReadFailure,
  applyMarkdownTabReadSuccess,
  beginFileTabRead,
  beginMarkdownTabRead,
  clearMobileSessionDocumentRead,
  deleteMobileSessionDocumentState,
  isCurrentMobileSessionDocumentRead,
  pruneMobileSessionDocumentReads,
  pruneMobileSessionDocumentStates,
  recoverInterruptedMobileSessionDocumentStates,
  reserveMobileSessionDocumentRead,
  type MobileSessionDocumentReadToken
} from './mobile-session-document-refresh'

const readyMarkdown: MarkdownDocState = {
  status: 'ready',
  baseVersion: '1',
  content: 'old',
  editable: true,
  isDirty: false,
  localContent: 'old'
}

const readyFile: FileDocState = {
  status: 'ready',
  byteLength: 3,
  content: 'old',
  kind: 'file',
  truncated: false
}

const markdownTab: Extract<MobileSessionTab, { type: 'markdown' }> = {
  type: 'markdown',
  filePath: '/repo/README.md',
  id: 'md-1',
  isActive: true,
  relativePath: 'README.md',
  title: 'README.md'
}

function requests() {
  return {
    file: new Map<string, MobileSessionDocumentReadToken>(),
    markdown: new Map<string, MobileSessionDocumentReadToken>()
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

type ReactDocumentReadHarnessHandle = {
  replaceAfterClear: (content: string) => void
  current: () => FileDocState | undefined
  read: () => Promise<void>
}

const ReactDocumentReadHarness = forwardRef<
  ReactDocumentReadHarnessHandle,
  { resolveDoc: () => Promise<FileDocState> }
>(function ReactDocumentReadHarness({ resolveDoc }, ref) {
  const [docs, setDocs] = useState(() => new Map<string, FileDocState>([['file-1', readyFile]]))
  const requestsRef = useRef(requests())

  useImperativeHandle(
    ref,
    () => ({
      replaceAfterClear: (content) => {
        clearMobileSessionDocumentRead(requestsRef.current, 'file-1')
        setDocs((prev) => new Map(prev).set('file-1', { ...readyFile, content }))
      },
      current: () => docs.get('file-1'),
      read: async () => {
        const request = reserveMobileSessionDocumentRead(requestsRef.current, 'file', 'file-1')
        setDocs((prev) => beginFileTabRead(prev, 'file-1'))
        const doc = await resolveDoc()
        setDocs((prev) =>
          isCurrentMobileSessionDocumentRead(requestsRef.current, request)
            ? applyFileTabReadSuccess(prev, 'file-1', doc)
            : prev
        )
      }
    }),
    [docs, resolveDoc]
  )

  return null
})

describe('mobile session document refresh state', () => {
  it('keeps ready markdown visible while refresh is in flight', () => {
    const docs = new Map([['md-1', readyMarkdown]])

    expect(beginMarkdownTabRead(docs, 'md-1').get('md-1')).toEqual({
      ...readyMarkdown,
      refreshing: true,
      refreshError: undefined
    })
    expect(beginMarkdownTabRead(new Map(), 'md-1').get('md-1')).toEqual({ status: 'loading' })
    expect(applyMarkdownTabReadFailure(docs, 'md-1', "Couldn't load markdown").get('md-1')).toEqual(
      {
        ...readyMarkdown,
        refreshError: "Couldn't load markdown",
        refreshing: false
      }
    )
  })

  it('protects dirty markdown during refresh and discards only when requested', () => {
    const dirty = new Map<string, MarkdownDocState>([
      ['md-1', { ...readyMarkdown, isDirty: true, localContent: 'phone draft' }]
    ])

    expect(
      applyMarkdownTabReadSuccess(dirty, 'md-1', {
        content: 'desktop',
        editable: true,
        isDirty: false,
        version: '2'
      }).get('md-1')
    ).toMatchObject({
      baseVersion: '1',
      content: 'old',
      isDirty: true,
      localContent: 'phone draft',
      stale: true
    })
    expect(
      applyMarkdownTabReadSuccess(
        dirty,
        'md-1',
        {
          content: 'desktop',
          editable: true,
          isDirty: false,
          version: '2'
        },
        { preserveDirty: false }
      ).get('md-1')
    ).toMatchObject({
      content: 'desktop',
      isDirty: false,
      localContent: 'desktop'
    })
  })

  it('preserves dirty markdown across disk fallback refresh', () => {
    const dirty = new Map<string, MarkdownDocState>([
      ['md-1', { ...readyMarkdown, isDirty: true, localContent: 'phone draft' }]
    ])

    expect(
      applyMarkdownDiskFallbackReadSuccess(dirty, markdownTab, {
        content: 'disk',
        truncated: false
      }).get('md-1')
    ).toMatchObject({
      baseVersion: '1',
      content: 'old',
      isDirty: true,
      localContent: 'phone draft',
      stale: true
    })
  })

  it('keeps ready file content visible when refresh fails', () => {
    const docs = new Map([['file-1', readyFile]])

    expect(beginFileTabRead(docs, 'file-1').get('file-1')).toEqual({
      ...readyFile,
      refreshing: true,
      refreshError: undefined
    })
    expect(
      applyFileTabReadFailure(docs, 'file-1', "Couldn't load file preview").get('file-1')
    ).toEqual({
      ...readyFile,
      refreshing: false,
      refreshError: "Couldn't load file preview"
    })
    expect(applyFileTabReadFailure(new Map(), 'file-1', 'Nope').get('file-1')).toEqual({
      status: 'error',
      message: 'Nope'
    })
  })

  it('clears refresh error after a successful file refresh', () => {
    const docs = new Map<string, FileDocState>([
      ['file-1', { ...readyFile, refreshError: 'Disconnected', refreshing: true }]
    ])

    expect(
      applyFileTabReadSuccess(docs, 'file-1', { ...readyFile, content: 'new' }).get('file-1')
    ).toEqual({
      ...readyFile,
      content: 'new',
      refreshing: false,
      refreshError: undefined
    })
  })

  it('fences stale and reopened document reads without reusing request identity', () => {
    const refs = requests()
    const first = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')
    const second = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')
    const third = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')

    expect(isCurrentMobileSessionDocumentRead(refs, first)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, second)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, third)).toBe(true)
    clearMobileSessionDocumentRead(refs, 'file-1')
    const reopened = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')
    expect(isCurrentMobileSessionDocumentRead(refs, first)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, second)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, third)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, reopened)).toBe(true)

    const markdown = reserveMobileSessionDocumentRead(refs, 'markdown', 'md-1')
    const file = reserveMobileSessionDocumentRead(refs, 'file', 'file-2')
    pruneMobileSessionDocumentReads(refs, new Set(['file-2']))
    expect(isCurrentMobileSessionDocumentRead(refs, markdown)).toBe(false)
    expect(isCurrentMobileSessionDocumentRead(refs, file)).toBe(true)
  })

  it('prunes cached document states only for closed tabs', () => {
    const docs = new Map<string, FileDocState>([
      ['keep', readyFile],
      ['closed', { ...readyFile, content: 'closed' }]
    ])

    expect([...pruneMobileSessionDocumentStates(docs, new Set(['keep'])).keys()]).toEqual(['keep'])
    expect([...deleteMobileSessionDocumentState(docs, 'closed').keys()]).toEqual(['keep'])
  })

  it('releases interrupted loading states so a later active or inactive tab can read again', () => {
    const refs = requests()
    const stale = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')
    const loading = new Map<string, FileDocState>([
      ['file-1', { status: 'loading' }],
      ['file-2', { ...readyFile, refreshing: true }]
    ])

    refs.file.clear()
    const recovered = recoverInterruptedMobileSessionDocumentStates(loading)
    expect(recovered.has('file-1')).toBe(false)
    expect(recovered.get('file-2')).toEqual({ ...readyFile, refreshing: false })
    expect(isCurrentMobileSessionDocumentRead(refs, stale)).toBe(false)

    const resumed = reserveMobileSessionDocumentRead(refs, 'file', 'file-1')
    const reading = beginFileTabRead(recovered, 'file-1')
    const completed = isCurrentMobileSessionDocumentRead(refs, resumed)
      ? applyFileTabReadSuccess(reading, 'file-1', { ...readyFile, content: 'resumed' })
      : reading
    expect(completed.get('file-1')).toMatchObject({ status: 'ready', content: 'resumed' })
  })

  it('retains a dirty markdown draft across an interrupted refresh and resumed read', () => {
    const dirty: MarkdownDocState = {
      ...readyMarkdown,
      isDirty: true,
      localContent: 'phone draft',
      refreshing: true
    }
    const recovered = recoverInterruptedMobileSessionDocumentStates(
      new Map<string, MarkdownDocState>([['md-1', dirty]])
    )
    expect(recovered.get('md-1')).toEqual({ ...dirty, refreshing: false })

    const refreshed = applyMarkdownTabReadSuccess(beginMarkdownTabRead(recovered, 'md-1'), 'md-1', {
      content: 'desktop change',
      editable: true,
      isDirty: false,
      version: '2'
    })
    expect(refreshed.get('md-1')).toMatchObject({
      content: 'old',
      localContent: 'phone draft',
      isDirty: true,
      refreshing: false,
      stale: true
    })
  })

  it('commits an immediate read response through React state batching', async () => {
    let api: ReactDocumentReadHarnessHandle | null = null
    let renderer: ReactTestRenderer | null = null

    act(() => {
      renderer = create(
        createElement(ReactDocumentReadHarness, {
          ref: (handle) => {
            api = handle
          },
          resolveDoc: () => Promise.resolve({ ...readyFile, content: 'new' })
        })
      )
    })

    await act(async () => {
      await api?.read()
    })

    expect(api?.current()).toMatchObject({
      content: 'new',
      refreshError: undefined,
      refreshing: false
    })
    act(() => renderer?.unmount())
  })

  it('lets only the latest async read update a retained React document surface', async () => {
    const first = deferred<FileDocState>()
    const second = deferred<FileDocState>()
    const responses = [first.promise, second.promise]
    let api: ReactDocumentReadHarnessHandle | null = null
    let renderer: ReactTestRenderer | null = null

    act(() => {
      renderer = create(
        createElement(ReactDocumentReadHarness, {
          ref: (handle) => {
            api = handle
          },
          resolveDoc: () => responses.shift() ?? Promise.resolve(readyFile)
        })
      )
    })

    let firstRead: Promise<void> | undefined
    let secondRead: Promise<void> | undefined
    act(() => {
      firstRead = api?.read()
      secondRead = api?.read()
    })

    await act(async () => {
      second.resolve({ ...readyFile, content: 'second' })
      await secondRead
    })
    expect(api?.current()).toMatchObject({ content: 'second' })

    await act(async () => {
      first.resolve({ ...readyFile, content: 'first' })
      await firstRead
    })

    expect(api?.current()).toMatchObject({ content: 'second' })
    act(() => renderer?.unmount())
  })

  it('does not let a cleared pending read overwrite a later React state commit', async () => {
    const staleRead = deferred<FileDocState>()
    let api: ReactDocumentReadHarnessHandle | null = null
    let renderer: ReactTestRenderer | null = null

    act(() => {
      renderer = create(
        createElement(ReactDocumentReadHarness, {
          ref: (handle) => {
            api = handle
          },
          resolveDoc: () => staleRead.promise
        })
      )
    })

    let read: Promise<void> | undefined
    act(() => {
      read = api?.read()
    })
    act(() => {
      api?.replaceAfterClear('saved')
    })

    await act(async () => {
      staleRead.resolve({ ...readyFile, content: 'stale remote' })
      await read
    })

    expect(api?.current()).toMatchObject({ content: 'saved' })
    act(() => renderer?.unmount())
  })
})
