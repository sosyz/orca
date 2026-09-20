import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostScreen } from '../../app/h/[hostId]/index'
import type { HostScreenState } from './use-host-screen-state'
import type { Worktree } from '../worktree/workspace-list-sections'

const deps = vi.hoisted(() => ({
  state: null as HostScreenState | null,
  delete: vi.fn(),
  remove: vi.fn(),
  routeHostId: 'host-a'
}))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
}))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ hostId: deps.routeHostId }) }))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Moon: 'Moon', GitBranch: 'GitBranch' }))
vi.mock('../agent-history/MobileAgentSessionHistoryIcon', () => ({
  MobileAgentSessionHistoryIcon: 'HistoryIcon'
}))
vi.mock('../cache/worktree-cache', () => ({ getCachedWorktrees: () => null }))
vi.mock('../components/WorkspaceDetailPlaceholder', () => ({
  WorkspaceDetailPlaceholder: 'Placeholder'
}))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: true })
}))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetContent: 'ActionSheetContent' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: 'ConfirmModal' }))
vi.mock('../components/NewWorktreeModalController', () => ({
  NewWorktreeModalController: 'NewWorktreeModalController'
}))
vi.mock('../components/PickerModal', () => ({ PickerModal: 'PickerModal' }))
vi.mock('./host-screen-view', async () => {
  const { HostScreenOverlays } = await import('./host-screen-overlays')
  return { HostScreenView: HostScreenOverlays }
})
vi.mock('./use-host-screen-controller', async () => {
  const { useHostScreenState } = await import('./use-host-screen-state')
  return {
    useHostScreenController: (props: { hostId?: string }) => {
      const hostId = props.hostId ?? deps.routeHostId
      const state = useHostScreenState(hostId, undefined)
      deps.state = state
      return {
        hostId,
        state,
        client: null,
        hostCapabilities: [],
        existingWorktreePaths: [],
        showNewWorktree: false,
        sectionsResult: { uniqueRepos: [] },
        catalog: { fetchWorktrees: vi.fn() },
        settings: { activeFilterCount: 0 },
        actions: {
          handleDeleteWorktree: (item: Worktree) => deps.delete(hostId, item.worktreeId),
          handleRemoveHost: () => deps.remove(hostId)
        }
      }
    }
  }
})
const item = { worktreeId: 'worktree-a', repo: 'repo-a', branch: 'feature' } as Worktree
let renderer: ReactTestRenderer | null = null
async function render(hostId?: string) {
  await act(async () => {
    const element = createElement(HostScreen, { hostId, embedded: true })
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}
async function openDelete() {
  await act(async () => {
    deps.state!.setActionTarget(item)
    deps.state!.setConfirmDelete(item)
  })
}
function deleteButton() {
  return renderer!.root
    .findAllByType('Pressable')
    .find((node) => node.findAllByType('Text').some((text) => text.children.join('') === 'Delete'))
}
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  deps.state = null
  deps.routeHostId = 'host-a'
  vi.clearAllMocks()
})
describe('HostScreen host ownership', () => {
  it('does not redirect an old workspace delete confirmation to a new sidebar host', async () => {
    await render('host-a')
    await openDelete()
    await render('host-b')
    const staleDelete = deleteButton()
    if (staleDelete) {
      await act(async () => staleDelete.props.onPress())
    }
    expect(deps.delete).not.toHaveBeenCalled()
    expect(deps.state!.confirmDelete).toBeNull()
    expect(deps.state!.actionTarget).toBeNull()
  })
  it('does not carry host-removal confirmation into a new host', async () => {
    await render('host-a')
    await act(async () => deps.state!.setConfirmRemoveHost(true))
    await render('host-b')
    const confirm = renderer!.root.findByType('ConfirmModal')
    if (confirm.props.visible) {
      await act(async () => confirm.props.onConfirm())
    }
    expect(deps.remove).not.toHaveBeenCalled()
    expect(confirm.props.visible).toBe(false)
  })
  it('also scopes host IDs supplied by phone route params', async () => {
    await render()
    await openDelete()
    deps.routeHostId = 'host-b'
    await render()
    expect(deps.state!.confirmDelete).toBeNull()
  })
  it('keeps the current host confirmation through ordinary rerenders', async () => {
    await render('host-a')
    await openDelete()
    await render('host-a')
    expect(deps.state!.confirmDelete).toEqual(item)
    await act(async () => deleteButton()!.props.onPress())
    expect(deps.delete).toHaveBeenCalledExactlyOnceWith('host-a', 'worktree-a')
  })
})
