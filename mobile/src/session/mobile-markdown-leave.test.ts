import { describe, expect, it, vi } from 'vitest'
import {
  collectDirtyMobileMarkdownDrafts,
  copyMobileMarkdownDraftsBeforeLeave
} from './mobile-markdown-leave'
import type {
  DirtyMarkdownDraft,
  MarkdownDocState,
  MobileSessionTab
} from './mobile-session-route-types'

function setup() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const pending = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const state = {
    current: true,
    drafts: [{ tabId: 'a', title: 'Note', content: 'phone draft' }] as DirtyMarkdownDraft[],
    copy: vi.fn(() => pending),
    leave: vi.fn(),
    onChanged: vi.fn(),
    onError: vi.fn(),
    resolve,
    reject,
    run: () =>
      copyMobileMarkdownDraftsBeforeLeave({
        isCurrent: () => state.current,
        getDrafts: () => state.drafts,
        copy: state.copy,
        leave: state.leave,
        onChanged: state.onChanged,
        onError: state.onError
      })
  }
  return state
}

describe('copy markdown drafts before leaving', () => {
  it('leaves only after the current clipboard write acknowledges all dirty drafts', async () => {
    const state = setup()
    state.drafts.push({ tabId: 'b', title: 'Other', content: 'second' })
    const run = state.run()
    expect(state.copy).toHaveBeenCalledWith('# Note\n\nphone draft\n\n---\n\n# Other\n\nsecond')
    expect(state.leave).not.toHaveBeenCalled()
    state.resolve()
    await run
    expect(state.leave).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'] as const)('ignores a detached source on %s', async (settle) => {
    const state = setup()
    const run = state.run()
    state.current = false
    if (settle === 'resolve') {
      state.resolve()
    } else {
      state.reject(new Error('clipboard unavailable'))
    }
    await run
    expect(state.leave).not.toHaveBeenCalled()
    expect(state.onChanged).not.toHaveBeenCalled()
    expect(state.onError).not.toHaveBeenCalled()
  })

  it('rejects an old callback before touching the clipboard', async () => {
    const state = setup()
    state.current = false
    await state.run()
    expect(state.copy).not.toHaveBeenCalled()
    expect(state.leave).not.toHaveBeenCalled()
  })

  it.each(['edit', 'add'] as const)(
    'retains %s made while clipboard is pending',
    async (change) => {
      const state = setup()
      const run = state.run()
      if (change === 'edit') {
        state.drafts[0]!.content = 'newer phone draft'
      } else {
        state.drafts.push({ tabId: 'b', title: 'New', content: 'unsaved' })
      }
      state.resolve()
      await run
      expect(state.leave).not.toHaveBeenCalled()
      expect(state.onChanged).toHaveBeenCalledWith(state.drafts)
    }
  )

  it('allows reordered drafts and drafts already saved or closed', async () => {
    const state = setup()
    state.drafts.push({ tabId: 'b', title: 'Other', content: 'second' })
    const run = state.run()
    state.drafts = [state.drafts[1]!]
    state.resolve()
    await run
    expect(state.leave).toHaveBeenCalledOnce()
    expect(state.onChanged).not.toHaveBeenCalled()
  })

  it('does not leave or destroy drafts when clipboard fails', async () => {
    const state = setup()
    const run = state.run()
    state.reject(new Error('clipboard unavailable'))
    await run
    expect(state.leave).not.toHaveBeenCalled()
    expect(state.onError).toHaveBeenCalledOnce()
    expect(state.drafts[0]?.content).toBe('phone draft')
  })

  it('leaves without erasing clipboard when drafts were saved before the action', async () => {
    const state = setup()
    state.drafts = []
    await state.run()
    expect(state.copy).not.toHaveBeenCalled()
    expect(state.leave).toHaveBeenCalledOnce()
  })

  it('collects ready dirty contents with the existing title fallback', () => {
    const ready: MarkdownDocState = {
      status: 'ready',
      content: 'disk',
      localContent: 'local',
      baseVersion: '1',
      editable: true,
      isDirty: true
    }
    const docs = new Map<string, MarkdownDocState>([
      ['a', ready],
      ['b', { ...ready, isDirty: false }],
      ['c', { status: 'loading' }],
      ['orphan', { ...ready, localContent: 'keep orphaned draft' }]
    ])
    const tabs = [{ id: 'a', title: 'Title' }] as MobileSessionTab[]
    expect(collectDirtyMobileMarkdownDrafts(docs, tabs)).toEqual([
      { tabId: 'a', title: 'Title', content: 'local' },
      { tabId: 'orphan', title: 'Markdown', content: 'keep orphaned draft' }
    ])
  })
})
