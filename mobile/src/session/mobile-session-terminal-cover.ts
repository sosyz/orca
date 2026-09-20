import type { MobileSessionTabType } from './mobile-session-route-types'

export type MobileSessionTerminalCoverState = {
  activeTabType: MobileSessionTabType | null
  browserActionSheetVisible: boolean
  createBrowserModalVisible: boolean
  deleteCustomKeySheetVisible: boolean
  dictationSetupVisible: boolean
  discardMarkdownConfirmVisible: boolean
  fileActionSheetVisible: boolean
  headerMoreActionsVisible: boolean
  leaveDraftsSheetVisible: boolean
  markdownActionSheetVisible: boolean
  newTabSheetVisible: boolean
  pendingDiffNotesSheetVisible: boolean
  quickCommandsSheetVisible: boolean
  renameTerminalModalVisible: boolean
  showNativeChat: boolean
  terminalActionSheetVisible: boolean
  customKeyModalVisible: boolean
}

export function isActiveTerminalCoveredBySessionOverlay({
  activeTabType,
  browserActionSheetVisible,
  createBrowserModalVisible,
  customKeyModalVisible,
  deleteCustomKeySheetVisible,
  dictationSetupVisible,
  discardMarkdownConfirmVisible,
  fileActionSheetVisible,
  headerMoreActionsVisible,
  leaveDraftsSheetVisible,
  markdownActionSheetVisible,
  newTabSheetVisible,
  pendingDiffNotesSheetVisible,
  quickCommandsSheetVisible,
  renameTerminalModalVisible,
  showNativeChat,
  terminalActionSheetVisible
}: MobileSessionTerminalCoverState): boolean {
  return (
    activeTabType === 'terminal' &&
    (showNativeChat ||
      newTabSheetVisible ||
      headerMoreActionsVisible ||
      quickCommandsSheetVisible ||
      pendingDiffNotesSheetVisible ||
      terminalActionSheetVisible ||
      markdownActionSheetVisible ||
      fileActionSheetVisible ||
      browserActionSheetVisible ||
      leaveDraftsSheetVisible ||
      discardMarkdownConfirmVisible ||
      renameTerminalModalVisible ||
      createBrowserModalVisible ||
      customKeyModalVisible ||
      dictationSetupVisible ||
      deleteCustomKeySheetVisible)
  )
}
