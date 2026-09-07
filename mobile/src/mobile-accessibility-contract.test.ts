import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('mobile icon-only button accessibility contracts', () => {
  it('labels the navigation buttons on the pairing and settings routes', () => {
    for (const path of [
      '../app/about.tsx',
      '../app/pair-scan.tsx',
      '../app/pair-confirm.tsx',
      '../app/notifications.tsx',
      '../app/settings.tsx',
      '../app/terminal-settings.tsx'
    ]) {
      const routeSource = source(path)
      expect(routeSource).toContain('accessibilityRole="button"')
      expect(routeSource).toContain('accessibilityLabel="Back"')
    }
  })

  it('labels the home settings button', () => {
    const topBarSource = source('./home/MobileHomeTopBar.tsx')
    expect(topBarSource).toContain('accessibilityRole="button"')
    expect(topBarSource).toContain('accessibilityLabel="Settings"')
  })

  it('labels both host header toolbar variants and disabled state', () => {
    const headerSource = source('./host-screen/host-screen-header.tsx')
    expect(headerSource).toContain('accessibilityLabel="Accounts"')
    expect(headerSource).toContain('accessibilityLabel="Tasks"')
    expect(headerSource).toContain(
      "accessibilityLabel={state.showSearch ? 'Close search' : 'Search workspaces'}"
    )
    expect(headerSource).toContain("accessibilityState={{ disabled: connState !== 'connected' }}")
  })
})
