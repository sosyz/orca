import { View } from 'react-native'
import {
  type ProviderRateLimits,
  getUsageBarState,
  getWindowResetLabel,
  UsageBar
} from '../components/AccountUsage'
import { styles } from './mobile-accounts-screen-styles'

export function MobileAccountUsageWindows({
  usage,
  isFetching,
  now
}: {
  usage: ProviderRateLimits | null
  isFetching?: boolean
  now: number
}) {
  const windows = usage?.fableWeekly
    ? (['session', 'weekly', 'fableWeekly'] as const)
    : (['session', 'weekly'] as const)
  return (
    <View style={[styles.usageRow, usage?.fableWeekly && styles.usageColumn]}>
      {windows.map((window) => {
        const bar = getUsageBarState(usage, window, isFetching)
        return (
          <UsageBar
            key={window}
            label={window === 'session' ? '5h' : window === 'weekly' ? '7d' : 'Fable'}
            usedPercent={bar.usedPercent}
            unavailable={bar.unavailable}
            loading={bar.loading}
            resetText={getWindowResetLabel(usage, window, now)}
          />
        )
      })}
    </View>
  )
}
