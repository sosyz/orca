import type { TFunction } from 'i18next'

import type { HostWorktreeInfo } from '../worktree/home-worktree-info'
import { HOME_WORKTREE_COUNTS_LIVE_MAX_AGE_MS } from '../worktree/home-worktree-info'
import type { ConnectionVerdict } from './connection-health'
import type { MobileConnectionPath } from './stable-logical-rpc-client'

function connectionBaseLabel(verdict: ConnectionVerdict, t: TFunction): string {
  switch (verdict.label) {
    case 'Pairing invalid — re-pair with your desktop':
      return t('mobile.connection.authFailed', 'Pairing invalid - re-pair with your desktop')
    case 'Connected':
      return t('mobile.connection.connected', 'Connected')
    case "Can't connect via Relay":
      return t('mobile.connection.cantConnectRelay', "Can't connect via Relay")
    case 'Connecting via Relay…':
      return t('mobile.connection.connectingRelay', 'Connecting via Relay…')
    case 'Disconnected':
      return t('mobile.connection.disconnected', 'Disconnected')
    case "Can't reach desktop":
      return t('mobile.connection.cantReach', "Can't reach desktop")
    case "Can't connect":
      return t('mobile.connection.cantConnect', "Can't connect")
    case 'Reconnecting…':
      return t('mobile.connection.reconnecting', 'Reconnecting…')
    case 'Connecting…':
      return t('mobile.connection.connecting', 'Connecting…')
    default:
      return verdict.label
  }
}

export function mobileConnectionVerdictLabel(verdict: ConnectionVerdict, t: TFunction): string {
  const label = connectionBaseLabel(verdict, t)
  if ((verdict.kind === 'warning' || verdict.kind === 'unreachable') && verdict.hint) {
    const hint =
      verdict.hint === 'check Tailscale'
        ? t('mobile.connection.checkTailscale', 'check Tailscale')
        : verdict.hint
    return `${label} - ${hint}`
  }
  return label
}

export function mobileConnectionPathDisplayLabel(path: MobileConnectionPath, t: TFunction): string {
  if (path === 'relay') {
    return t('mobile.connection.orcaRelay', 'Orca Relay')
  }
  return path === 'tailscale'
    ? t('mobile.connection.directTailscale', 'Direct · Tailscale')
    : t('mobile.connection.directLan', 'Direct · LAN')
}

export function mobileConnectionPathSpokenLabel(path: MobileConnectionPath, t: TFunction): string {
  if (path === 'relay') {
    return t('mobile.connection.pathSpoken.orcaRelay', 'Orca Relay')
  }
  return path === 'tailscale'
    ? t('mobile.connection.pathSpoken.directTailscale', 'Direct via Tailscale')
    : t('mobile.connection.pathSpoken.directLan', 'Direct via LAN')
}

function provenRecently(info: HostWorktreeInfo, now: number): boolean {
  return (
    typeof info.countsProvenAt === 'number' &&
    now - info.countsProvenAt <= HOME_WORKTREE_COUNTS_LIVE_MAX_AGE_MS
  )
}

export function mobileHomeWorktreeSummaryLabel(
  info: HostWorktreeInfo | undefined,
  t: TFunction,
  now: number = Date.now()
): string | null {
  if (!info) {
    return null
  }
  if (info.catalogUnavailable && !info.staleCounts) {
    return t('mobile.home.worktreeListUnavailable', 'Worktree list unavailable')
  }
  const worktreeCount = t(
    info.totalWorktrees === 1 ? 'mobile.home.worktreeCount' : 'mobile.home.worktreeCountPlural',
    info.totalWorktrees === 1 ? '{{value}} worktree' : '{{value}} worktrees',
    { value: String(info.totalWorktrees) }
  )
  const counts =
    info.activeCount > 0
      ? `${worktreeCount} · ${t('mobile.home.activeWorktrees', '{{value}} active', {
          value: String(info.activeCount)
        })}`
      : worktreeCount
  return info.staleCounts || !provenRecently(info, now)
    ? t('mobile.home.lastKnownWorktrees', 'Last known: {{value}}', { value: counts })
    : counts
}
