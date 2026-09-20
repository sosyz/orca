import { createElement, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileSourceControlPanel } from './MobileSourceControlPanel'

const mocks = vi.hoisted(() => ({
  confirmation: null as null | { visible: boolean; onConfirm: () => void },
  activateOldUi: null as null | (() => void),
  openDiscard: null as null | (() => void),
  sendGitRequest: vi.fn(),
  uiState: null as null | {
    branchDiffPreview: boolean
    busyAction: string | null
    showActionSheet: boolean
    showBranchPicker: boolean
  }
}))

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Pressable: () => null,
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: () => null,
  View: ({ children }: { children?: ReactNode }) => createElement('View', null, children)
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('View', null, children)
}))
vi.mock('./use-mobile-source-control-state', () => ({
  useMobileSourceControlState: ({ worktreeId }: { worktreeId: string }) => {
    const [discardTarget, setDiscardTarget] = useState<{ path: string } | null>(null)
    const [branchDiffPreview, setBranchDiffPreview] = useState(false)
    const [busyAction, setBusyAction] = useState<string | null>(null)
    const [showActionSheet, setShowActionSheet] = useState(false)
    const [showBranchPicker, setShowBranchPicker] = useState(false)
    mocks.openDiscard = () => setDiscardTarget({ path: 'same.txt' })
    mocks.activateOldUi = () => {
      setBranchDiffPreview(true)
      setBusyAction('stage')
      setShowActionSheet(true)
      setShowBranchPicker(true)
    }
    mocks.uiState = { branchDiffPreview, busyAction, showActionSheet, showBranchPicker }
    return {
      branchEntries: [],
      branchLabel: '',
      branchDiffPreview,
      busyAction,
      client: null,
      connState: 'connected',
      createdPrUrl: null,
      createdPrWarning: null,
      discardTarget,
      forceReconnect: vi.fn(),
      insets: { bottom: 0 },
      loadStatus: vi.fn(),
      openingBranchPath: null,
      openingPath: null,
      router: { back: vi.fn() },
      runGitAction: (_actionId: string, method: string, params: { filePath: string }) =>
        mocks.sendGitRequest(method, { worktree: `id:${worktreeId}`, ...params }),
      screenState: { kind: 'loading' },
      setBranchDiffPreview,
      setDiscardTarget,
      setRootRef: vi.fn(),
      setShowActionSheet,
      setShowBranchPicker,
      setCreatedPrUrl: vi.fn(),
      setCreatedPrWarning: vi.fn(),
      showActionSheet,
      showBranchPicker,
      status: null,
      syncLabel: null,
      unstagedCount: 0,
      stagedCount: 0,
      worktreeLabel: worktreeId
    }
  }
}))
vi.mock('../session/use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: () => ({
    prSidebarIsGithubRepo: false,
    prSidebarState: { kind: 'hidden' },
    refetchPRSidebar: vi.fn(),
    ensurePRSidebarDetails: vi.fn()
  })
}))
vi.mock('./use-mobile-source-control-action-sheet', () => ({
  useMobileSourceControlActionSheet: () => []
}))
vi.mock('./MobileSourceControlHeader', () => ({ MobileSourceControlHeader: () => null }))
vi.mock('./MobileSourceControlSegments', () => ({ MobileSourceControlSegments: () => null }))
vi.mock('./MobileSourceControlContent', () => ({ MobileSourceControlContent: () => null }))
vi.mock('./MobileSourceControlBranchCard', () => ({ MobileSourceControlBranchCard: () => null }))
vi.mock('./MobileGitHistoryList', () => ({ MobileGitHistoryList: () => null }))
vi.mock('../components/pr-sidebar/MobilePrViewPanel', () => ({ MobilePrViewPanelBody: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/PickerModal', () => ({ PickerModal: () => null }))
vi.mock('./MobileBranchDiffPreviewDrawer', () => ({ MobileBranchDiffPreviewDrawer: () => null }))
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: (props: { visible: boolean; onConfirm: () => void; title: string }) => {
    if (props.title === 'Discard Change') {
      mocks.confirmation = { visible: props.visible, onConfirm: props.onConfirm }
    }
    return null
  }
}))

describe('MobileSourceControlPanel scope', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mocks.confirmation = null
    mocks.activateOldUi = null
    mocks.openDiscard = null
    mocks.sendGitRequest.mockClear()
    mocks.uiState = null
  })

  it.each([
    { nextHostId: 'host', nextWorktreeId: 'second' },
    { nextHostId: 'other-host', nextWorktreeId: 'first' }
  ])(
    'hides an old discard confirmation after changing scope to $nextHostId/$nextWorktreeId',
    ({ nextHostId, nextWorktreeId }) => {
      act(() => {
        renderer = create(
          createElement(MobileSourceControlPanel, { hostId: 'host', worktreeId: 'first' })
        )
      })
      act(() => {
        mocks.openDiscard?.()
        mocks.activateOldUi?.()
      })
      expect(mocks.confirmation?.visible).toBe(true)
      expect(mocks.uiState).toEqual({
        branchDiffPreview: true,
        busyAction: 'stage',
        showActionSheet: true,
        showBranchPicker: true
      })

      act(() => {
        renderer!.update(
          createElement(MobileSourceControlPanel, {
            hostId: nextHostId,
            worktreeId: nextWorktreeId
          })
        )
      })
      expect(mocks.confirmation?.visible).toBe(false)
      expect(mocks.uiState).toEqual({
        branchDiffPreview: false,
        busyAction: null,
        showActionSheet: false,
        showBranchPicker: false
      })
      act(() => mocks.confirmation?.onConfirm())
      expect(mocks.sendGitRequest).not.toHaveBeenCalled()
    }
  )
})
