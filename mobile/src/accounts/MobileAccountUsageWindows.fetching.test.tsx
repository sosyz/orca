import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { UsageBar, type ProviderRateLimits } from '../components/AccountUsage'
import { MobileAccountUsageWindows } from './MobileAccountUsageWindows'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

const fetchingFableUsage: ProviderRateLimits = {
  provider: 'claude',
  session: null,
  weekly: null,
  fableWeekly: {
    usedPercent: 99,
    windowMinutes: 10_080,
    resetsAt: null,
    resetDescription: null
  },
  updatedAt: 1,
  error: null,
  status: 'fetching'
}

async function render(props: { isFetching?: boolean } = {}): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(MobileAccountUsageWindows, { usage: fetchingFableUsage, now: 1_000, ...props })
    )
  })
  if (!renderer) {
    throw new Error('Usage windows did not render')
  }
  return renderer
}

function barStates(renderer: ReactTestRenderer): Array<[string, boolean, boolean]> {
  return renderer.root
    .findAllByType(UsageBar)
    .map((bar) => [bar.props.label, bar.props.loading, bar.props.unavailable])
}

describe('MobileAccountUsageWindows', () => {
  it('keeps missing system-default windows loading while Fable usage refreshes', async () => {
    const renderer = await render()
    expect(barStates(renderer)).toEqual([
      ['5h', true, false],
      ['7d', true, false],
      ['Fable', false, false]
    ])
    await act(async () => renderer.unmount())
  })

  it('honors an explicit inactive-account fetching override', async () => {
    const renderer = await render({ isFetching: false })
    expect(barStates(renderer)).toEqual([
      ['5h', false, true],
      ['7d', false, true],
      ['Fable', false, false]
    ])
    await act(async () => renderer.unmount())
  })
})
