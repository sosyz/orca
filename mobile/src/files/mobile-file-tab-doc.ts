import { buildImageDataUri } from '../../../src/shared/image-data-uri'
import type { RuntimeMobileSessionHistoricalDiff } from '../../../src/shared/runtime-mobile-session-tab-contracts'
import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import { buildMobileDiffLines, type MobileDiffLine } from '../session/mobile-diff-lines'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { mobileDiffImageDataUri, type MobileBinaryDiffResult } from './mobile-diff-image-preview'
import { isMobileMethodUnavailableError } from './file-list-fallback'

type FileTabDocClient = Pick<RpcClient, 'sendRequest'>

// The ready doc a session file tab renders. Mirrors the ready arm of the route's
// FileDocState; kept in src so the loader stays testable without the route.
export type MobileFileTabDoc =
  | { status: 'ready'; kind: 'file'; content: string; truncated: boolean; byteLength: number }
  | { status: 'ready'; kind: 'diff'; lines: MobileDiffLine[]; truncated: boolean }
  | { status: 'ready'; kind: 'image'; dataUri: string }
  | { status: 'ready'; kind: 'html'; content: string }

export type MobileFileTabDocRequest = {
  worktreeId: string
  relativePath: string
  mode?: 'edit' | 'diff'
  diffSource?: 'staged' | 'unstaged' | 'branch' | 'commit'
  historicalDiff?: RuntimeMobileSessionHistoricalDiff
}

// Throws 'binary_file'/'file_too_large'/the RPC error message; callers map those
// to error docs.
export async function resolveMobileFileTabDoc(
  client: FileTabDocClient,
  request: MobileFileTabDocRequest
): Promise<MobileFileTabDoc> {
  const worktree = `id:${request.worktreeId}`
  const { relativePath } = request
  const diffRequest = resolveDiffRequest(request)
  if (diffRequest) {
    const response = await client.sendRequest(diffRequest.method, {
      worktree,
      filePath: relativePath,
      ...diffRequest.params
    })
    if (!response.ok) {
      const { error } = response as RpcFailure
      if (request.historicalDiff && isMobileMethodUnavailableError(error.code, error.message)) {
        throw new Error('historical_diff_unavailable')
      }
      throw new Error(error.message)
    }
    const result = (response as RpcSuccess).result as
      | { kind: 'text'; originalContent: string; modifiedContent: string }
      | MobileBinaryDiffResult
    if (result.kind !== 'text') {
      // Render image diffs (add/modify/delete) from the base64 the host already
      // sends; only non-previewable binaries stay unavailable.
      const dataUri = mobileDiffImageDataUri(result)
      if (!dataUri) {
        throw new Error('binary_file')
      }
      return { status: 'ready', kind: 'image', dataUri }
    }
    const diff = buildMobileDiffLines(result.originalContent, result.modifiedContent)
    return { status: 'ready', kind: 'diff', lines: diff.lines, truncated: diff.truncated }
  }

  const artifactKind = classifyMobileArtifact(relativePath)
  if (artifactKind === 'image') {
    const preview = await client.sendRequest('files.readPreview', { worktree, relativePath })
    if (!preview.ok) {
      throw new Error((preview as RpcFailure).error.message)
    }
    const result = (preview as RpcSuccess).result as {
      content: string
      isImage?: boolean
      mimeType?: string
    }
    const dataUri = result.isImage ? buildImageDataUri(result.mimeType, result.content) : null
    if (!dataUri) {
      throw new Error('binary_file')
    }
    return { status: 'ready', kind: 'image', dataUri }
  }

  const response = await client.sendRequest('files.read', { worktree, relativePath })
  if (!response.ok) {
    throw new Error((response as RpcFailure).error.message)
  }
  const result = (response as RpcSuccess).result as {
    content: string
    truncated: boolean
    byteLength: number
  }
  if (artifactKind === 'html') {
    return { status: 'ready', kind: 'html', content: result.content }
  }
  return {
    status: 'ready',
    kind: 'file',
    content: result.content,
    truncated: result.truncated,
    byteLength: result.byteLength
  }
}

function resolveDiffRequest(request: MobileFileTabDocRequest) {
  const comparison = request.historicalDiff
  if (comparison?.kind === 'branch' && comparison.mergeBase && comparison.headOid) {
    return {
      method: 'git.branchDiff',
      params: {
        compare: { mergeBase: comparison.mergeBase, headOid: comparison.headOid },
        ...(comparison.oldPath ? { oldPath: comparison.oldPath } : {})
      }
    }
  }
  if (comparison?.kind === 'commit' && comparison.commitOid && comparison.parentOid !== undefined) {
    return {
      method: 'git.commitDiff',
      params: {
        commitOid: comparison.commitOid,
        parentOid: comparison.parentOid,
        ...(comparison.oldPath ? { oldPath: comparison.oldPath } : {})
      }
    }
  }
  if (comparison) {
    throw new Error('historical_diff_unavailable')
  }
  if (request.diffSource === 'staged' || request.diffSource === 'unstaged') {
    return { method: 'git.diff', params: { staged: request.diffSource === 'staged' } }
  }
  if (request.mode === 'diff' || request.diffSource) {
    throw new Error('historical_diff_unavailable')
  }
  return null
}
