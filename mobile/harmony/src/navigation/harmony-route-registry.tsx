import type { ComponentType } from 'react'

import AboutScreen from '../../../app/about'
import BrowserSettingsScreen from '../../../app/browser-settings'
import ConnectionLogScreen from '../../../app/connection-log'
import HostAccountsScreen from '../../../app/h/[hostId]/accounts'
import HostAgentHistoryScreen from '../../../app/h/[hostId]/agent-history/[worktreeId]'
import HostEditScreen from '../../../app/h/[hostId]/edit'
import HostFilesScreen from '../../../app/h/[hostId]/files/[worktreeId]'
import HostFilePreviewScreen from '../../../app/h/[hostId]/files/preview/[worktreeId]'
import HostHistoryScreen from '../../../app/h/[hostId]/history/[worktreeId]'
import HostScreen from '../../../app/h/[hostId]/index'
import HostPullRequestScreen from '../../../app/h/[hostId]/pr/[worktreeId]'
import HostReviewScreen from '../../../app/h/[hostId]/review/[worktreeId]'
import HostSessionScreen from '../../../app/h/[hostId]/session/[worktreeId]'
import HostSourceControlScreen from '../../../app/h/[hostId]/source-control/[worktreeId]'
import HostTasksScreen from '../../../app/h/[hostId]/tasks'
import HostGroupLayout from '../../../app/h/_layout'
import HomeScreen from '../../../app/index'
import MobileOnboardingScreen from '../../../app/mobile-onboarding'
import NativeChatSettingsScreen from '../../../app/native-chat-settings'
import NotificationOptInScreen from '../../../app/notification-opt-in'
import NotificationsScreen from '../../../app/notifications'
import PairScreen from '../../../app/pair'
import PairConfirmScreen from '../../../app/pair-confirm'
import PairScanScreen from '../../../app/pair-scan'
import SettingsScreen from '../../../app/settings'
import TerminalSettingsScreen from '../../../app/terminal-settings'
import TroubleshootScreen from '../../../app/troubleshoot'
import VoiceSettingsScreen from '../../../app/voice-settings'
import { matchHarmonyHostRoutePath, matchHarmonyRootRoutePath } from './harmony-route-state'

export type HarmonyRouteMatch = {
  component: ComponentType
  name: string
  params: Record<string, string>
}

const ROOT_ROUTES = new Map<string, ComponentType>([
  ['index', HomeScreen],
  ['about', AboutScreen],
  ['browser-settings', BrowserSettingsScreen],
  ['connection-log', ConnectionLogScreen],
  ['mobile-onboarding', MobileOnboardingScreen],
  ['native-chat-settings', NativeChatSettingsScreen],
  ['notification-opt-in', NotificationOptInScreen],
  ['notifications', NotificationsScreen],
  ['pair', PairScreen],
  ['pair-confirm', PairConfirmScreen],
  ['pair-scan', PairScanScreen],
  ['settings', SettingsScreen],
  ['terminal-settings', TerminalSettingsScreen],
  ['troubleshoot', TroubleshootScreen],
  ['voice-settings', VoiceSettingsScreen]
])

const HOST_ROUTES = new Map<string, ComponentType>([
  ['[hostId]/index', HostScreen],
  ['[hostId]/accounts', HostAccountsScreen],
  ['[hostId]/edit', HostEditScreen],
  ['[hostId]/tasks', HostTasksScreen],
  ['[hostId]/agent-history/[worktreeId]', HostAgentHistoryScreen],
  ['[hostId]/files/preview/[worktreeId]', HostFilePreviewScreen],
  ['[hostId]/files/[worktreeId]', HostFilesScreen],
  ['[hostId]/history/[worktreeId]', HostHistoryScreen],
  ['[hostId]/pr/[worktreeId]', HostPullRequestScreen],
  ['[hostId]/review/[worktreeId]', HostReviewScreen],
  ['[hostId]/session/[worktreeId]', HostSessionScreen],
  ['[hostId]/source-control/[worktreeId]', HostSourceControlScreen]
])

export function matchRootRoute(pathname: string): HarmonyRouteMatch | null {
  const match = matchHarmonyRootRoutePath(pathname)
  if (!match) {
    return null
  }
  if (match.name === 'h') {
    return { component: HostGroupLayout, name: match.name, params: match.params }
  }
  const component = ROOT_ROUTES.get(match.name)
  return component ? { component, name: match.name, params: match.params } : null
}

export function matchHostRoute(pathname: string): HarmonyRouteMatch | null {
  const match = matchHarmonyHostRoutePath(pathname)
  const component = match ? HOST_ROUTES.get(match.name) : null
  return match && component ? { component, name: match.name, params: match.params } : null
}
