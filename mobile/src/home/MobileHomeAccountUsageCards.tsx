import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  getActiveProviderRateLimits,
  getUsageBarState,
  hasActiveProviderUsage,
  UsageBar,
  type AccountsSnapshot,
  type ProviderKey
} from '../components/AccountUsage'
import { getMobileAccountDisplayActiveId } from '../components/mobile-account-display-selection'
import { colors, radii, spacing } from '../theme/mobile-theme'
import type { HostProfile } from '../transport/types'

export function MobileHomeAccountUsageCards(props: {
  items: { host: HostProfile; snapshot: AccountsSnapshot }[]
  onOpen: (hostId: string) => void
}) {
  const { t } = useTranslation()

  if (props.items.length === 0) {
    return null
  }
  return (
    <>
      <Text style={styles.sectionHeading}>{t('mobile.home.accountUsage', 'Account usage')}</Text>
      {props.items.map(({ host, snapshot }) => {
        const claudeActiveId = getMobileAccountDisplayActiveId(snapshot, 'claude')
        const codexActiveId = getMobileAccountDisplayActiveId(snapshot, 'codex')
        const claudeActive =
          snapshot.claude.accounts.find((account) => account.id === claudeActiveId) ?? null
        const codexActive =
          snapshot.codex.accounts.find((account) => account.id === codexActiveId) ?? null
        return (
          <Pressable
            key={host.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => props.onOpen(host.id)}
          >
            {props.items.length > 1 ? (
              <Text style={styles.hostLabel} numberOfLines={1}>
                {host.name}
              </Text>
            ) : null}
            {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
              const active = provider === 'claude' ? claudeActive : codexActive
              const accounts =
                provider === 'claude' ? snapshot.claude.accounts : snapshot.codex.accounts
              const limits = getActiveProviderRateLimits(snapshot, provider)
              if (accounts.length === 0 && !hasActiveProviderUsage(limits)) {
                return null
              }
              const sessionBar = getUsageBarState(limits, 'session')
              const weeklyBar = getUsageBarState(limits, 'weekly')
              const fableBar = limits?.fableWeekly ? getUsageBarState(limits, 'fableWeekly') : null
              return (
                <View key={provider} style={styles.row}>
                  <View style={styles.icon}>
                    {provider === 'claude' ? (
                      <ClaudeIcon size={18} />
                    ) : (
                      <OpenAIIcon size={18} color={colors.textPrimary} />
                    )}
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.email} numberOfLines={1}>
                      {active?.email ?? t('mobile.home.systemDefault', 'System default')}
                    </Text>
                    <View style={[styles.bars, fableBar && styles.barsStacked]}>
                      <UsageBar
                        label="5h"
                        usedPercent={sessionBar.usedPercent}
                        unavailable={sessionBar.unavailable}
                        loading={sessionBar.loading}
                      />
                      <UsageBar
                        label="7d"
                        usedPercent={weeklyBar.usedPercent}
                        unavailable={weeklyBar.unavailable}
                        loading={weeklyBar.loading}
                      />
                      {fableBar ? (
                        <UsageBar
                          label="Fable"
                          usedPercent={fableBar.usedPercent}
                          unavailable={fableBar.unavailable}
                          loading={fableBar.loading}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              )
            })}
          </Pressable>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  cardPressed: { backgroundColor: colors.bgRaised },
  hostLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  info: { flex: 1, minWidth: 0, gap: 2 },
  email: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  bars: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  barsStacked: { flexDirection: 'column', gap: spacing.xs }
})
