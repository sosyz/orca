import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'

it('authorizes a paired mobile files.stat through the existing runtime path boundary', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-files-stat-rpc-'))
  try {
    const { runtime } = createMobileRpcSurfaceRuntime()
    const stat = vi.fn().mockResolvedValue({ size: 0, mtime: 1, isDirectory: true })
    runtime.statRuntimeFile = stat
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    server['deviceRegistry'] = new DeviceRegistry(userDataPath)
    const mobile = server['deviceRegistry']!.addDevice('phone', 'mobile')
    const replies: unknown[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({
        id: 'stat',
        method: 'files.stat',
        deviceToken: mobile.token,
        params: { worktree: 'id:folder-a', relativePath: 'docs/linked' }
      }),
      (response) => replies.push(JSON.parse(response)),
      () => {}
    )
    expect(replies).toEqual([
      expect.objectContaining({
        id: 'stat',
        ok: true,
        result: { size: 0, mtime: 1, isDirectory: true }
      })
    ])
    expect(stat).toHaveBeenCalledExactlyOnceWith('id:folder-a', 'docs/linked')
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})
