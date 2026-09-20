import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { decodeAccountsSnapshot } from '../components/accounts-snapshot'
import { UsageBar } from '../components/AccountUsage'
import type { HostProfile } from '../transport/types'
import { MobileHomeAccountUsageCards } from './MobileHomeAccountUsageCards'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))
vi.mock('../components/AgentIcons', () => ({
  ClaudeIcon: 'ClaudeIcon',
  OpenAIIcon: 'OpenAIIcon'
}))

const host = { id: 'host-1', name: 'Desk' } as HostProfile
const window = (usedPercent: number) => ({
  usedPercent,
  windowMinutes: 10_080,
  resetsAt: null,
  resetDescription: null
})

function snapshot(options: { managed?: boolean; fable?: boolean } = {}) {
  const managed = options.managed ?? true
  return decodeAccountsSnapshot({
    claude: {
      accounts: managed
        ? [
            { id: 'claude-host', email: 'claude-host@example.com' },
            {
              id: 'claude-wsl',
              email: 'claude-wsl@example.com',
              managedAuthRuntime: 'wsl',
              wslDistro: 'Ubuntu'
            }
          ]
        : [],
      activeAccountId: managed ? 'claude-host' : null,
      activeAccountIdsByRuntime: {
        host: managed ? 'claude-host' : null,
        wsl: { Ubuntu: 'claude-wsl' }
      }
    },
    codex: {
      accounts: managed
        ? [
            { id: 'codex-host', email: 'codex-host@example.com', updatedAt: 1 },
            {
              id: 'codex-wsl',
              email: 'codex-wsl@example.com',
              managedHomeRuntime: 'wsl',
              wslDistro: 'Ubuntu',
              updatedAt: 1
            }
          ]
        : [],
      activeAccountId: managed ? 'codex-host' : null,
      activeAccountIdsByRuntime: {
        host: managed ? 'codex-host' : null,
        wsl: { Ubuntu: 'codex-wsl' }
      }
    },
    rateLimits: {
      claude: {
        provider: 'claude',
        session: null,
        weekly: null,
        fableWeekly: options.fable ? window(99) : null,
        updatedAt: 1,
        error: null,
        status: 'ok'
      },
      codex: {
        provider: 'codex',
        session: window(32),
        weekly: null,
        updatedAt: 1,
        error: null,
        status: 'ok'
      },
      claudeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' },
      codexTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  })
}

async function render(snapshotValue: ReturnType<typeof snapshot>): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(MobileHomeAccountUsageCards, {
        items: [{ host, snapshot: snapshotValue }],
        onOpen: vi.fn()
      })
    )
  })
  if (!renderer) {
    throw new Error('Home account card did not render')
  }
  return renderer
}

describe('MobileHomeAccountUsageCards', () => {
  it('labels both providers by the usage target and stacks the Fable window', async () => {
    const renderer = await render(snapshot({ fable: true }))
    const text = renderer.root.findAllByType('Text').map((node) => node.children.join(''))
    expect(text).toContain('claude-wsl@example.com')
    expect(text).toContain('codex-wsl@example.com')
    expect(text).not.toContain('claude-host@example.com')
    expect(text).not.toContain('codex-host@example.com')
    const fable = renderer.root.findAllByType(UsageBar).find((node) => node.props.label === 'Fable')
    expect(fable?.props.usedPercent).toBe(99)
    expect(fable?.parent?.props.style).toContainEqual(
      expect.objectContaining({ flexDirection: 'column' })
    )
    renderer.unmount()
  })

  it('renders Fable-only system-default Claude usage', async () => {
    const renderer = await render(snapshot({ managed: false, fable: true }))
    expect(renderer.root.findAllByType(UsageBar).some((node) => node.props.label === 'Fable')).toBe(
      true
    )
    expect(renderer.root.findAllByType('Text').map((node) => node.children.join(''))).toContain(
      'System default'
    )
    renderer.unmount()
  })
})
