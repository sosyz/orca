import { describe, expect, it, vi } from 'vitest'
import { resolveMobileFileTabDoc } from '../../mobile/src/files/mobile-file-tab-doc'
import type { RpcResponse } from '../../mobile/src/transport/types'
import type { OpenFile } from '../../src/renderer/src/store/slices/editor/types/open-file'
import {
  buildMobileSessionTabSnapshots,
  getRuntimeMobileSessionSyncKey,
  runtimeMobileSessionSyncKeysEqual
} from '../../src/renderer/src/runtime/sync-runtime-graph'
import { makeState } from '../../src/renderer/src/runtime/sync-runtime-graph-test-harness'

const BASE_OID = 'a'.repeat(40)
const HEAD_OID = 'b'.repeat(40)

function publishFile(overrides: Partial<OpenFile>) {
  const file: OpenFile = {
    id: 'historical-diff',
    filePath: '/repo/src/current.ts',
    relativePath: 'src/current.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'diff',
    isDirty: false,
    ...overrides
  }
  const tab = buildMobileSessionTabSnapshots(
    makeState({
      tabBarOrderByWorktree: { 'wt-1': [file.id] },
      openFiles: [file]
    })
  )[0]?.tabs[0]
  if (tab?.type !== 'file') {
    throw new Error('Expected the desktop diff to publish a mobile file tab')
  }
  return tab
}

function clientWithCurrentAndHistoricalContent() {
  return {
    sendRequest: vi.fn(async (method: string): Promise<RpcResponse> => ({
      id: 'request',
      ok: true,
      _meta: { runtimeId: 'host' },
      result:
        method === 'files.read'
          ? { content: 'WORKING COPY\n', byteLength: 13, truncated: false }
          : {
              kind: 'text',
              originalContent: 'BEFORE COMMIT\n',
              modifiedContent: 'AFTER COMMIT\n',
              originalIsBinary: false,
              modifiedIsBinary: false
            }
    }))
  }
}

describe('desktop historical file tabs on mobile', () => {
  it('re-publishes comparison endpoints and rename paths changed on the same entity', () => {
    const file: OpenFile = {
      id: 'historical-diff',
      filePath: '/repo/src/current.ts',
      relativePath: 'src/current.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'diff',
      diffSource: 'commit',
      isDirty: false,
      commitCompare: {
        commitOid: HEAD_OID,
        parentOid: BASE_OID,
        compareRef: HEAD_OID,
        baseRef: BASE_OID,
        compareVersion: `${BASE_OID}:${HEAD_OID}`
      }
    }
    const base = makeState({ openFiles: [file] })
    const initial = getRuntimeMobileSessionSyncKey(base)
    for (const changed of [
      { ...file, commitCompare: { ...file.commitCompare!, commitOid: 'c'.repeat(40) } },
      { ...file, branchOldPath: 'src/previous.ts' }
    ]) {
      const next = makeState({ ...base, openFiles: [changed] })
      expect(
        runtimeMobileSessionSyncKeysEqual(
          initial,
          getRuntimeMobileSessionSyncKey(next, base, initial)
        )
      ).toBe(false)
    }
  })

  it.each(['branch', 'commit'] as const)(
    'loads the published %s comparison instead of current disk content',
    async (diffSource) => {
      const tab = publishFile({
        diffSource,
        branchOldPath: 'src/previous.ts',
        ...(diffSource === 'branch'
          ? {
              branchCompare: {
                baseRef: 'main',
                baseOid: BASE_OID,
                compareRef: 'feature',
                headOid: HEAD_OID,
                mergeBase: BASE_OID,
                compareVersion: 'branch-version'
              }
            }
          : {
              commitCompare: {
                commitOid: HEAD_OID,
                parentOid: BASE_OID,
                compareRef: HEAD_OID,
                baseRef: BASE_OID,
                compareVersion: 'commit-version'
              }
            })
      })
      const client = clientWithCurrentAndHistoricalContent()

      const doc = await resolveMobileFileTabDoc(client, { worktreeId: 'wt-1', ...tab })

      expect(doc).toMatchObject({
        status: 'ready',
        kind: 'diff',
        lines: [
          { kind: 'delete', text: 'BEFORE COMMIT' },
          { kind: 'add', text: 'AFTER COMMIT' }
        ]
      })
      expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith(
        diffSource === 'branch' ? 'git.branchDiff' : 'git.commitDiff',
        {
          worktree: 'id:wt-1',
          filePath: 'src/current.ts',
          oldPath: 'src/previous.ts',
          ...(diffSource === 'branch'
            ? { compare: { mergeBase: BASE_OID, headOid: HEAD_OID } }
            : { commitOid: HEAD_OID, parentOid: BASE_OID })
        }
      )
      expect(tab.mode).toBe('diff')
      expect(tab).not.toHaveProperty('diffSource')
    }
  )

  it('does not substitute current text when a legacy host omits the comparison', async () => {
    const tab = publishFile({ diffSource: 'commit' })
    const client = clientWithCurrentAndHistoricalContent()

    await expect(resolveMobileFileTabDoc(client, { worktreeId: 'wt-1', ...tab })).rejects.toThrow()
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('preserves the explicit empty parent of a root commit through publication', async () => {
    const tab = publishFile({
      diffSource: 'commit',
      commitCompare: {
        commitOid: HEAD_OID,
        parentOid: null,
        compareRef: HEAD_OID,
        baseRef: 'empty-tree',
        compareVersion: `empty-tree:${HEAD_OID}`
      }
    })
    const client = clientWithCurrentAndHistoricalContent()

    await resolveMobileFileTabDoc(client, { worktreeId: 'wt-1', ...tab })

    expect(client.sendRequest).toHaveBeenCalledExactlyOnceWith('git.commitDiff', {
      worktree: 'id:wt-1',
      filePath: 'src/current.ts',
      commitOid: HEAD_OID,
      parentOid: null
    })
  })
})
