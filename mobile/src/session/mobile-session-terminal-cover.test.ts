import { describe, expect, it } from 'vitest'
import {
  isActiveTerminalCoveredBySessionOverlay,
  type MobileSessionTerminalCoverState
} from './mobile-session-terminal-cover'

const uncoveredTerminal: MobileSessionTerminalCoverState = {
  activeTabType: 'terminal',
  browserActionSheetVisible: false,
  createBrowserModalVisible: false,
  customKeyModalVisible: false,
  deleteCustomKeySheetVisible: false,
  dictationSetupVisible: false,
  discardMarkdownConfirmVisible: false,
  fileActionSheetVisible: false,
  headerMoreActionsVisible: false,
  leaveDraftsSheetVisible: false,
  markdownActionSheetVisible: false,
  newTabSheetVisible: false,
  pendingDiffNotesSheetVisible: false,
  quickCommandsSheetVisible: false,
  renameTerminalModalVisible: false,
  showNativeChat: false,
  terminalActionSheetVisible: false
}

describe('isActiveTerminalCoveredBySessionOverlay', () => {
  it('covers the active terminal for every session sheet and modal', () => {
    const overlayFields = [
      'showNativeChat',
      'newTabSheetVisible',
      'headerMoreActionsVisible',
      'quickCommandsSheetVisible',
      'pendingDiffNotesSheetVisible',
      'terminalActionSheetVisible',
      'markdownActionSheetVisible',
      'fileActionSheetVisible',
      'browserActionSheetVisible',
      'leaveDraftsSheetVisible',
      'discardMarkdownConfirmVisible',
      'renameTerminalModalVisible',
      'createBrowserModalVisible',
      'customKeyModalVisible',
      'dictationSetupVisible',
      'deleteCustomKeySheetVisible'
    ] satisfies Array<keyof MobileSessionTerminalCoverState>

    for (const field of overlayFields) {
      expect(
        isActiveTerminalCoveredBySessionOverlay({
          ...uncoveredTerminal,
          [field]: true
        })
      ).toBe(true)
    }
  })

  it('does not cover non-terminal tabs or an uncovered terminal', () => {
    expect(isActiveTerminalCoveredBySessionOverlay(uncoveredTerminal)).toBe(false)
    expect(
      isActiveTerminalCoveredBySessionOverlay({
        ...uncoveredTerminal,
        activeTabType: 'browser',
        newTabSheetVisible: true
      })
    ).toBe(false)
  })
})
