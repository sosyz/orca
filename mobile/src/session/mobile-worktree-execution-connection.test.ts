import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { FLOATING_WORKSPACE_WORKTREE_ID } from './floating-workspace'
import { attachMobileImageToTerminal } from './mobile-image-attachment'
import { uploadMobileNativeChatImages } from './mobile-native-chat-image-attachment'
import { resolveMobileWorktreeExecutionConnectionId } from './mobile-worktree-execution-connection'

function makeClient(result: unknown): Pick<RpcClient, 'sendRequest'> {
  return {
    sendRequest: vi.fn(async () => ({
      id: 'rpc-1',
      ok: true as const,
      result,
      _meta: { runtimeId: 'runtime-1' }
    }))
  }
}

describe('mobile worktree execution connection', () => {
  it.each(['git', 'folder'])('resolves an SSH %s workspace to its execution host', async (kind) => {
    const client = makeClient({
      repos: [
        { id: 'other-repo', connectionId: null },
        { id: 'workspace', kind, connectionId: ' ssh-target ' }
      ]
    })
    await expect(
      resolveMobileWorktreeExecutionConnectionId(client, 'workspace::/remote/project')
    ).resolves.toBe('ssh-target')
  })

  it.each([undefined, null, ''])(
    'accepts a known local folder with connection %s',
    async (connectionId) => {
      const client = makeClient({ repos: [{ id: 'workspace', kind: 'folder', connectionId }] })
      await expect(
        resolveMobileWorktreeExecutionConnectionId(client, 'workspace::C:\\project')
      ).resolves.toBeNull()
    }
  )

  it('resolves the floating workspace locally without repo metadata', async () => {
    const client = makeClient(null)
    await expect(
      resolveMobileWorktreeExecutionConnectionId(client, FLOATING_WORKSPACE_WORKTREE_ID)
    ).resolves.toBeNull()
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it.each([null, {}, { repos: [] }, { repos: [{ id: 'different-repo' }] }])(
    'does not substitute the paired host when the repo is absent: %j',
    async (result) => {
      await expect(
        resolveMobileWorktreeExecutionConnectionId(makeClient(result), 'remote-repo::/project')
      ).rejects.toThrow('worktree_repo_not_found')
    }
  )

  it('preserves a host lookup failure', async () => {
    const client = makeClient(null)
    vi.mocked(client.sendRequest).mockResolvedValue({
      id: 'rpc-1',
      ok: false,
      error: { code: 'unavailable', message: 'repo catalog unavailable' },
      _meta: { runtimeId: 'runtime-1' }
    } satisfies RpcResponse)
    await expect(
      resolveMobileWorktreeExecutionConnectionId(client, 'remote-repo::/project')
    ).rejects.toThrow('repo catalog unavailable')
  })

  it.each(['terminal', 'chat'])(
    'prevents %s image uploads to an unverified execution host',
    async (surface) => {
      const client = makeClient({ repos: [] })
      const getConnectionId = () =>
        resolveMobileWorktreeExecutionConnectionId(client, 'remote-repo::/project')
      const image = { base64: 'AAAA', uri: 'file:///photo.png' }
      const uploading =
        surface === 'terminal'
          ? attachMobileImageToTerminal('library', {
              client,
              terminal: 'remote-terminal',
              deviceToken: null,
              getConnectionId,
              pickImage: async () => image
            })
          : uploadMobileNativeChatImages('library', {
              client,
              getConnectionId,
              pickImages: async () => [image]
            })

      await expect(uploading).rejects.toThrow('worktree_repo_not_found')
      expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('repo.list')
    }
  )
})
