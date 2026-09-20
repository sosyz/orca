import type { PickerOption } from '../components/PickerModal'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'

type WorkspacePickerTranslator = (key: string, fallback: string) => string

const defaultTranslate: WorkspacePickerTranslator = (_key, fallback) => fallback

export const WORKSPACE_SORT_OPTIONS: PickerOption<MobileSortMode>[] = [
  // Why: desktop and persisted state keep the `smart` key, while mobile shows the product label.
  {
    value: 'smart',
    label: 'Agent activity',
    subtitle: 'Agents that need attention, then recent activity'
  },
  { value: 'name', label: 'Name', subtitle: 'Alphabetical by name' },
  { value: 'recent', label: 'Recent', subtitle: 'Most recent output first' },
  { value: 'repo', label: 'Repo', subtitle: 'Repository, then workspace name' },
  { value: 'manual', label: 'Manual', subtitle: 'Server order' }
]

export const WORKSPACE_GROUP_OPTIONS: PickerOption<MobileGroupMode>[] = [
  { value: 'none', label: 'No Grouping' },
  { value: 'workspaceStatus', label: 'Status' },
  { value: 'repo', label: 'Repository' },
  { value: 'prStatus', label: 'PR Status' }
]

const SORT_LABEL_KEYS: Record<MobileSortMode, { label: string; subtitle: string }> = {
  smart: {
    label: 'mobile.workspace.list.sortOptions.smart.label',
    subtitle: 'mobile.workspace.list.sortOptions.smart.subtitle'
  },
  name: {
    label: 'mobile.workspace.list.sortOptions.name.label',
    subtitle: 'mobile.workspace.list.sortOptions.name.subtitle'
  },
  recent: {
    label: 'mobile.workspace.list.sortOptions.recent.label',
    subtitle: 'mobile.workspace.list.sortOptions.recent.subtitle'
  },
  repo: {
    label: 'mobile.workspace.list.sortOptions.repo.label',
    subtitle: 'mobile.workspace.list.sortOptions.repo.subtitle'
  },
  manual: {
    label: 'mobile.workspace.list.sortOptions.manual.label',
    subtitle: 'mobile.workspace.list.sortOptions.manual.subtitle'
  }
}

const GROUP_LABEL_KEYS: Record<MobileGroupMode, string> = {
  none: 'mobile.workspace.list.groupOptions.none',
  workspaceStatus: 'mobile.workspace.list.groupOptions.workspaceStatus',
  repo: 'mobile.workspace.list.groupOptions.repo',
  prStatus: 'mobile.workspace.list.groupOptions.prStatus'
}

export function getWorkspaceSortOptions(
  t: WorkspacePickerTranslator = defaultTranslate
): PickerOption<MobileSortMode>[] {
  return WORKSPACE_SORT_OPTIONS.map((option) => {
    const keys = SORT_LABEL_KEYS[option.value]
    return {
      ...option,
      label: t(keys.label, option.label),
      subtitle: option.subtitle ? t(keys.subtitle, option.subtitle) : option.subtitle
    }
  })
}

export function getWorkspaceGroupOptions(
  t: WorkspacePickerTranslator = defaultTranslate
): PickerOption<MobileGroupMode>[] {
  return WORKSPACE_GROUP_OPTIONS.map((option) => ({
    ...option,
    label: t(GROUP_LABEL_KEYS[option.value], option.label)
  }))
}

export function getWorkspaceSortLabel(
  sortMode: MobileSortMode,
  t: WorkspacePickerTranslator = defaultTranslate
): string {
  return getWorkspaceSortOptions(t).find((option) => option.value === sortMode)?.label ?? 'Recent'
}
