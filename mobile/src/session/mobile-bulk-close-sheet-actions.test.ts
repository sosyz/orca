import { describe, expect, it, vi } from 'vitest'
import {
  createBulkCloseSheetActions,
  createCloseWithBulkActions
} from './mobile-bulk-close-sheet-actions'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

function markdown(id: string): MobileSessionTab {
  return { id, type: 'markdown', title: id, relativePath: `${id}.md`, isActive: false }
}

function createHarness() {
  const sessionTabsRef = { current: [markdown('first'), markdown('second'), markdown('anchor')] }
  const markdownDocsRef = { current: new Map<string, MarkdownDocState>() }
  let finishFirst!: () => void
  const firstClose = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const closeSessionTab = vi.fn(async (tab: MobileSessionTab) => {
    if (tab.id === 'first') {
      await firstClose
    }
    sessionTabsRef.current = sessionTabsRef.current.filter((item) => item.id !== tab.id)
  })
  const actions = createBulkCloseSheetActions({
    sessionTabsRef,
    markdownDocsRef,
    activeSessionTabIdRef: { current: 'anchor' },
    switchSessionTab: vi.fn(),
    closeSessionTab
  })
  return { sessionTabsRef, markdownDocsRef, finishFirst, closeSessionTab, actions }
}

describe('bulk close pending operations', () => {
  it('preserves a document edited while an earlier close is awaiting the host', async () => {
    const harness = createHarness()
    const closeOthers = harness
      .actions('anchor', vi.fn())
      .find((action) => action.label === 'Close Other Tabs')!
    closeOthers.onPress()
    expect(harness.closeSessionTab.mock.calls.map(([tab]) => tab.id)).toEqual(['first'])
    harness.markdownDocsRef.current = new Map([
      [
        'second',
        {
          status: 'ready',
          content: '',
          localContent: 'new unsaved text',
          baseVersion: 'v1',
          isDirty: true,
          editable: true
        }
      ]
    ])
    harness.finishFirst()
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.closeSessionTab.mock.calls.map(([tab]) => tab.id)).toEqual(['first'])
    expect(harness.sessionTabsRef.current.map((tab) => tab.id)).toEqual(['second', 'anchor'])
  })

  it('does not add newly opened tabs to an already started bulk close', async () => {
    const harness = createHarness()
    harness.actions('anchor', vi.fn())[0]!.onPress()
    harness.sessionTabsRef.current.push(markdown('new'))
    harness.finishFirst()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.closeSessionTab.mock.calls.map(([tab]) => tab.id)).toEqual(['first', 'second'])
    expect(harness.sessionTabsRef.current.map((tab) => tab.id)).toEqual(['anchor', 'new'])
  })
})

describe('single markdown close', () => {
  it('drops a sheet action whose target is no longer in the current workspace', () => {
    const harness = createHarness()
    const onDirtyClose = vi.fn()
    let current = true
    const close = createCloseWithBulkActions(harness.closeSessionTab, harness.actions, {
      markdownDocsRef: harness.markdownDocsRef,
      isCurrentTarget: () => current,
      onDirtyClose
    })(markdown('second'), vi.fn())[0]!
    current = false
    close.onPress()
    expect(harness.closeSessionTab).not.toHaveBeenCalled()
    expect(onDirtyClose).not.toHaveBeenCalled()
  })

  it('asks before closing a phone draft even when the host tab still reports clean', () => {
    const harness = createHarness()
    const onDirtyClose = vi.fn()
    const close = createCloseWithBulkActions(harness.closeSessionTab, harness.actions, {
      markdownDocsRef: harness.markdownDocsRef,
      isCurrentTarget: () => true,
      onDirtyClose
    })(markdown('second'), vi.fn())[0]!
    harness.markdownDocsRef.current = new Map([
      [
        'second',
        {
          status: 'ready',
          content: '',
          localContent: 'unsaved',
          baseVersion: 'v1',
          editable: true,
          isDirty: true
        }
      ]
    ])
    close.onPress()
    expect(harness.closeSessionTab).not.toHaveBeenCalled()
    expect(onDirtyClose).toHaveBeenCalledWith(markdown('second'))
    expect(close.closeBeforePress).toBe(true)
  })

  it('closes a clean document without requesting a discard confirmation', () => {
    const harness = createHarness()
    const onDirtyClose = vi.fn()
    const close = createCloseWithBulkActions(harness.closeSessionTab, harness.actions, {
      markdownDocsRef: harness.markdownDocsRef,
      isCurrentTarget: () => true,
      onDirtyClose
    })(markdown('second'), vi.fn())[0]!
    close.onPress()
    expect(harness.closeSessionTab).toHaveBeenCalledWith(markdown('second'))
    expect(onDirtyClose).not.toHaveBeenCalled()
  })
})
