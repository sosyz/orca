import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import type { RpcClient } from '../transport/rpc-client'
import { MAX_QUICK_COMMANDS } from '../terminal/quick-commands'
import { QuickCommandsSheet } from './QuickCommandsSheet'

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  commands: [] as TerminalQuickCommand[],
  persist: vi.fn()
}))
const quickCommandEditorForm = 'QuickCommandEditorForm'
const quickCommandsList = 'QuickCommandsList'
const command: TerminalQuickCommand = {
  id: 'command',
  label: 'Test',
  action: 'terminal-command',
  command: 'pnpm test',
  appendEnter: true,
  scope: { type: 'global' }
}

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))

vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: ReactNode }) => children
}))

vi.mock('./QuickCommandEditorForm', () => ({
  QuickCommandEditorForm: 'QuickCommandEditorForm'
}))

vi.mock('./QuickCommandsList', () => ({
  QuickCommandAgentPicker: 'QuickCommandAgentPicker',
  QuickCommandsList: 'QuickCommandsList'
}))

vi.mock('./use-quick-commands', () => ({
  useQuickCommands: () => ({
    commands: mocks.commands,
    loading: false,
    ready: true,
    error: null,
    persist: mocks.persist
  })
}))

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('QuickCommandsSheet', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    mocks.alert.mockReset()
    mocks.commands = []
    mocks.persist.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the sheet open when a launch is rejected', async () => {
    const onClose = vi.fn()
    const onLaunch = vi.fn(() => false)
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose,
          client: {} as RpcClient,
          repoId: 'repo-1',
          repoName: 'Repo',
          onLaunch
        })
      )
    })

    act(() => renderer!.root.findByType(quickCommandsList).props.onLaunch(command))

    expect(onLaunch).toHaveBeenCalledWith(command)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('submits one full-list mutation for a same-frame double tap', async () => {
    const save = deferred<boolean>()
    mocks.persist.mockReturnValue(save.promise)
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose: vi.fn(),
          client: {} as RpcClient,
          repoId: 'repo-1',
          repoName: 'Repo',
          onLaunch: () => true
        })
      )
    })

    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    const editor = renderer!.root.findByType(quickCommandEditorForm)
    act(() => {
      editor.props.onChange({ label: 'Test' })
      editor.props.onChange({ command: 'pnpm test' })
    })
    const readyEditor = renderer!.root.findByType(quickCommandEditorForm)
    act(() => {
      readyEditor.props.onSave()
      readyEditor.props.onSave()
    })

    expect(mocks.persist).toHaveBeenCalledTimes(1)
    await act(async () => {
      save.resolve(true)
      await save.promise
    })
  })

  it('keeps a new draft opened while an earlier save is still pending', async () => {
    const save = deferred<boolean>()
    mocks.persist.mockReturnValue(save.promise)
    const client = {} as RpcClient
    const props = {
      onClose: vi.fn(),
      client,
      repoId: 'repo-1',
      repoName: 'Repo',
      onLaunch: () => true
    }
    await act(async () => {
      renderer = create(createElement(QuickCommandsSheet, { ...props, visible: true }))
    })
    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    act(() => {
      const editor = renderer!.root.findByType(quickCommandEditorForm)
      editor.props.onChange({ label: 'First' })
      editor.props.onChange({ command: 'echo first' })
    })
    act(() => renderer!.root.findByType(quickCommandEditorForm).props.onSave())

    await act(async () => {
      renderer!.update(createElement(QuickCommandsSheet, { ...props, visible: false }))
    })
    await act(async () => {
      renderer!.update(createElement(QuickCommandsSheet, { ...props, visible: true }))
    })
    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    act(() => renderer!.root.findByType(quickCommandEditorForm).props.onChange({ label: 'Second' }))

    await act(async () => {
      save.resolve(true)
      await save.promise
    })
    expect(renderer!.root.findByType(quickCommandEditorForm).props.draft.label).toBe('Second')
  })

  it('keeps edits made to the same draft after the save was dispatched', async () => {
    const save = deferred<boolean>()
    mocks.persist.mockReturnValue(save.promise)
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose: vi.fn(),
          client: {} as RpcClient,
          repoId: 'repo-1',
          repoName: 'Repo',
          onLaunch: () => true
        })
      )
    })
    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    act(() => {
      const editor = renderer!.root.findByType(quickCommandEditorForm)
      editor.props.onChange({ label: 'First' })
      editor.props.onChange({ command: 'echo first' })
    })
    act(() => renderer!.root.findByType(quickCommandEditorForm).props.onSave())
    act(() =>
      renderer!.root.findByType(quickCommandEditorForm).props.onChange({ label: 'Revised' })
    )

    await act(async () => {
      save.resolve(true)
      await save.promise
    })
    expect(renderer!.root.findByType(quickCommandEditorForm).props.draft.label).toBe('Revised')
  })

  it('lets a new client save independently of the prior client pending save', async () => {
    const firstSave = deferred<boolean>()
    const secondSave = deferred<boolean>()
    mocks.persist.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(secondSave.promise)
    const client = {} as RpcClient
    const nextClient = {} as RpcClient
    const props = {
      onClose: vi.fn(),
      client,
      repoId: 'repo-1',
      repoName: 'Repo',
      onLaunch: () => true
    }
    await act(async () => {
      renderer = create(createElement(QuickCommandsSheet, { ...props, visible: true }))
    })
    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    act(() => {
      const editor = renderer!.root.findByType(quickCommandEditorForm)
      editor.props.onChange({ label: 'First' })
      editor.props.onChange({ command: 'echo first' })
    })
    act(() => renderer!.root.findByType(quickCommandEditorForm).props.onSave())
    await act(async () => {
      renderer!.update(
        createElement(QuickCommandsSheet, { ...props, client: nextClient, visible: false })
      )
    })
    await act(async () => {
      renderer!.update(
        createElement(QuickCommandsSheet, { ...props, client: nextClient, visible: true })
      )
    })
    act(() => renderer!.root.findByType(quickCommandsList).props.onAdd())
    act(() => {
      const editor = renderer!.root.findByType(quickCommandEditorForm)
      editor.props.onChange({ label: 'Second' })
      editor.props.onChange({ command: 'echo second' })
    })
    act(() => renderer!.root.findByType(quickCommandEditorForm).props.onSave())
    expect(mocks.persist).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstSave.resolve(true)
      await firstSave.promise
    })
    expect(renderer!.root.findByType(quickCommandEditorForm).props.draft.label).toBe('Second')
    expect(renderer!.root.findByType(quickCommandEditorForm).props.saving).toBe(true)
    await act(async () => {
      secondSave.resolve(true)
      await secondSave.promise
    })
    expect(renderer!.root.findAllByType(quickCommandEditorForm)).toHaveLength(0)
  })

  it('keeps creation closed when the host command limit is reached', async () => {
    mocks.commands = Array.from({ length: MAX_QUICK_COMMANDS }, (_, index) => ({
      ...command,
      id: `command-${index}`
    }))
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose: vi.fn(),
          client: {} as RpcClient,
          repoId: 'repo-1',
          repoName: 'Repo',
          onLaunch: () => true
        })
      )
    })

    const list = renderer!.root.findByType(quickCommandsList)
    expect(list.props.canAdd).toBe(false)
    act(() => list.props.onAdd())
    expect(renderer!.root.findAllByType(quickCommandEditorForm)).toHaveLength(0)
  })

  it('shows only global commands and defaults new commands to global without a repo', async () => {
    const repoCommand: TerminalQuickCommand = {
      ...command,
      id: 'repo-command',
      scope: { type: 'repo', repoId: 'repo-1' }
    }
    mocks.commands = [command, repoCommand]
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose: vi.fn(),
          client: {} as RpcClient,
          repoId: null,
          repoName: 'Folder workspace',
          onLaunch: () => true
        })
      )
    })

    const list = renderer!.root.findByType(quickCommandsList)
    expect(list.props.globalCommands).toEqual([command])
    expect(list.props.repoCommands).toEqual([])
    act(() => list.props.onAdd())
    expect(renderer!.root.findByType(quickCommandEditorForm).props.draft.scope).toEqual({
      type: 'global'
    })
  })

  it('does not delete a shared command until the destructive action is confirmed', async () => {
    await act(async () => {
      renderer = create(
        createElement(QuickCommandsSheet, {
          visible: true,
          onClose: vi.fn(),
          client: {} as RpcClient,
          repoId: 'repo-1',
          repoName: 'Repo',
          onLaunch: () => true
        })
      )
    })

    act(() => renderer!.root.findByType(quickCommandsList).props.onDelete(command))
    expect(mocks.persist).not.toHaveBeenCalled()

    const actions = mocks.alert.mock.calls[0]?.[2] as
      | Array<{ style?: string; onPress?: () => void }>
      | undefined
    act(() => actions?.find((action) => action.style === 'destructive')?.onPress?.())

    expect(mocks.persist).toHaveBeenCalledTimes(1)
    expect(mocks.persist).toHaveBeenCalledWith({ type: 'delete', id: command.id })
  })
})
