import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'

describe('mobile Claude target selection authorization', () => {
  let userDataPath: string | undefined

  afterEach(() => {
    if (userDataPath) {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it.each([
    { runtime: 'host', wslDistro: null },
    { runtime: 'wsl', wslDistro: 'Ubuntu' }
  ])('allows a paired mobile device to select $runtime/$wslDistro', async (target) => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-account-target-rpc-'))
    const { runtime, mocks } = createMobileRpcSurfaceRuntime()
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    server['deviceRegistry'] = new DeviceRegistry(userDataPath)
    const mobile = server['deviceRegistry']!.addDevice('phone', 'mobile')
    const replies: unknown[] = []

    await server['handleWebSocketMessage'](
      JSON.stringify({
        id: 'select-target',
        method: 'accounts.selectClaudeForTarget',
        deviceToken: mobile.token,
        params: { accountId: null, target }
      }),
      (response) => replies.push(JSON.parse(response)),
      () => {}
    )

    expect(replies).toEqual([expect.objectContaining({ id: 'select-target', ok: true })])
    expect(mocks.selectClaudeAccountForTarget).toHaveBeenCalledWith(null, target)
    expect(mocks.selectClaudeAccount).not.toHaveBeenCalled()
    expect(mocks.selectCodexAccount).not.toHaveBeenCalled()
  })
})
