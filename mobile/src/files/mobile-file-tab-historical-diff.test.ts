import { describe, expect, it, vi } from 'vitest'
import type { RuntimeMobileSessionHistoricalDiff } from '../../../src/shared/runtime-mobile-session-tab-contracts'
import type { RpcResponse } from '../transport/types'
import { mobileSessionTabsEqual } from '../session/mobile-terminal-records'
import { resolveMobileFileTabDoc } from './mobile-file-tab-doc'

const historicalDiff: RuntimeMobileSessionHistoricalDiff = {
  kind: 'commit',
  commitOid: 'a'.repeat(40),
  parentOid: 'b'.repeat(40)
}
const request = {
  worktreeId: 'workspace',
  relativePath: 'removed.ts',
  mode: 'diff' as const,
  historicalDiff
}
function clientReturning(result: unknown) {
  return {
    sendRequest: vi.fn(async (): Promise<RpcResponse> => ({
      id: 'request',
      ok: true,
      result,
      _meta: { runtimeId: 'host' }
    }))
  }
}

describe('historical mobile file diffs', () => {
  it('renders a deleted historical file without trying to read its current path', async () => {
    const client = clientReturning({
      kind: 'text',
      originalContent: 'removed line\n',
      modifiedContent: ''
    })
    const doc = await resolveMobileFileTabDoc(client, request)

    expect(doc).toEqual({
      status: 'ready',
      kind: 'diff',
      truncated: false,
      lines: [{ kind: 'delete', text: 'removed line', oldLineNumber: 1 }]
    })
    expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('git.commitDiff', {
      worktree: 'id:workspace',
      filePath: 'removed.ts',
      commitOid: historicalDiff.commitOid,
      parentOid: historicalDiff.parentOid
    })
  })

  it('reuses the existing image deletion preview for historical comparisons', async () => {
    const client = clientReturning({
      kind: 'binary',
      originalContent: 'b2xk',
      modifiedContent: '',
      modifiedDeleted: true,
      isImage: true,
      mimeType: 'image/png'
    })
    const doc = await resolveMobileFileTabDoc(client, { ...request, relativePath: 'removed.png' })

    expect(doc).toEqual({ status: 'ready', kind: 'image', dataUri: 'data:image/png;base64,b2xk' })
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed or capped modified image unavailable instead of showing old bytes', async () => {
    const client = clientReturning({
      kind: 'binary',
      originalContent: 'b2xk',
      modifiedContent: '',
      modifiedDeleted: false,
      isImage: true,
      mimeType: 'image/png'
    })
    await expect(resolveMobileFileTabDoc(client, request)).rejects.toThrow('binary_file')
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it.each(['method_not_found', 'forbidden'])(
    'reports an old host %s without falling back to current bytes',
    async (code) => {
      const client = {
        sendRequest: vi.fn(async (): Promise<RpcResponse> => ({
          id: 'request',
          ok: false,
          error: { code, message: 'Unsupported method' },
          _meta: { runtimeId: 'host' }
        }))
      }

      await expect(resolveMobileFileTabDoc(client, request)).rejects.toThrow(
        'historical_diff_unavailable'
      )
      expect(client.sendRequest).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['ssh_unavailable', 'SSH Git provider unavailable'],
    ['not_found', 'Folder workspace is not a Git worktree'],
    ['invalid_params', 'Unknown comparison object'],
    ['diff_too_large', 'Diff exceeds the transport budget']
  ])('preserves %s errors without mutable branch or filesystem fallback', async (code, message) => {
    const client = {
      sendRequest: vi.fn(async (): Promise<RpcResponse> => ({
        id: 'request',
        ok: false,
        error: { code, message },
        _meta: { runtimeId: 'host' }
      }))
    }
    await expect(resolveMobileFileTabDoc(client, request)).rejects.toThrow(message)
    expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('git.commitDiff', expect.any(Object))
  })

  it('keeps ordinary folder workspace files on the existing filesystem reader', async () => {
    const client = clientReturning({ content: 'folder content', byteLength: 14, truncated: false })

    const doc = await resolveMobileFileTabDoc(client, {
      worktreeId: 'folder-workspace',
      relativePath: 'notes.txt',
      mode: 'edit'
    })

    expect(doc).toMatchObject({ kind: 'file', content: 'folder content' })
    expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('files.read', {
      worktree: 'id:folder-workspace',
      relativePath: 'notes.txt'
    })
  })

  it.each([
    { kind: 'branch', mergeBase: '', headOid: 'a'.repeat(40) },
    { kind: 'commit', commitOid: 'a'.repeat(40) }
  ])('rejects incomplete comparison metadata without guessing revisions', async (incomplete) => {
    const client = clientReturning({ content: 'current text' })
    await expect(
      resolveMobileFileTabDoc(client, {
        ...request,
        diffSource: 'unstaged',
        historicalDiff: incomplete as RuntimeMobileSessionHistoricalDiff
      })
    ).rejects.toThrow('historical_diff_unavailable')
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('does not suppress a comparison added or changed on a retained file tab', () => {
    const tab = { type: 'file' as const, id: 'file', title: 'file.ts', mode: 'diff' as const }
    const historical = { ...tab, historicalDiff }
    expect(mobileSessionTabsEqual([tab], [historical])).toBe(false)
    expect(mobileSessionTabsEqual([historical], [tab])).toBe(false)
    expect(
      mobileSessionTabsEqual(
        [historical],
        [{ ...historical, historicalDiff: { ...historicalDiff } }]
      )
    ).toBe(true)
    expect(
      mobileSessionTabsEqual(
        [historical],
        [{ ...historical, historicalDiff: { ...historicalDiff, commitOid: 'c'.repeat(40) } }]
      )
    ).toBe(false)
    expect(mobileSessionTabsEqual([tab], [{ ...tab, mode: 'edit' }])).toBe(false)
    expect(mobileSessionTabsEqual([tab], [{ ...tab, diffSource: 'staged' }])).toBe(false)
  })
})
