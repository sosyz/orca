import type { PickerOption } from '../components/PickerModal'

export type RestoreValue = 'indefinite' | '60s' | '5m' | '30m'

export const AUTO_RESTORE_FIT_OPTION_DEFINITIONS: readonly {
  value: RestoreValue
  labelKey: string
  fallback: string
  ms: number | null
}[] = [
  {
    value: 'indefinite',
    labelKey: 'mobile.settings.terminalSettings.restore.options.indefinite',
    fallback: 'Keep at phone size (default)',
    ms: null
  },
  {
    value: '60s',
    labelKey: 'mobile.settings.terminalSettings.restore.options.afterOneMinute',
    fallback: 'After 1 minute',
    ms: 60_000
  },
  {
    value: '5m',
    labelKey: 'mobile.settings.terminalSettings.restore.options.afterFiveMinutes',
    fallback: 'After 5 minutes',
    ms: 5 * 60_000
  },
  {
    value: '30m',
    labelKey: 'mobile.settings.terminalSettings.restore.options.afterThirtyMinutes',
    fallback: 'After 30 minutes',
    ms: 30 * 60_000
  }
]

export function valueFromMs(ms: number | null | undefined): RestoreValue {
  if (ms == null) {
    return 'indefinite'
  }
  const exact = AUTO_RESTORE_FIT_OPTION_DEFINITIONS.find((option) => option.ms === ms)
  if (exact) {
    return exact.value
  }
  let closest: (typeof AUTO_RESTORE_FIT_OPTION_DEFINITIONS)[number] | null = null
  let bestDelta = Infinity
  for (const option of AUTO_RESTORE_FIT_OPTION_DEFINITIONS) {
    if (option.ms == null) {
      continue
    }
    const delta = Math.abs(option.ms - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      closest = option
    }
  }
  return closest ? closest.value : 'indefinite'
}

export function autoRestoreSummary(
  ms: number | null | undefined,
  options: readonly (PickerOption<RestoreValue> & { ms: number | null })[],
  customSecondsSummary: string
): string {
  if (ms === undefined) {
    return '…'
  }
  if (ms === null) {
    return options[0]!.label
  }
  const exact = options.find((option) => option.ms === ms)
  return exact ? exact.label : customSecondsSummary
}
