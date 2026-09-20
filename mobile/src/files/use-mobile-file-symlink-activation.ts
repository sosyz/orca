import {
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { getDirectoryCacheState, type DirectoryCache, type TreeNode } from './file-tree'
import type { DirectoryLoadRevisions } from './directory-load-revisions'
import { isMobileMethodUnavailableError } from './file-list-fallback'
import { canPreviewMobileFileRow } from './mobile-file-preview-navigation'

export type SymlinkActivationState = { loading?: boolean; error?: string }
type Args = {
  client: RpcClient | null
  connected: boolean
  scope: string
  worktreeId: string
  directoryCache: DirectoryCache
  setDirectoryCache: Dispatch<SetStateAction<DirectoryCache>>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  directoryLoadRevisionsRef: RefObject<DirectoryLoadRevisions>
  rootLoadInFlightRef: RefObject<boolean>
  previewFile: (relativePath: string, name: string) => void
  toggleDirectory: (relativePath: string) => void
}

export function useMobileFileSymlinkActivation(args: Args) {
  const latestRef = useRef(args)
  const pendingRef = useRef(new Map<string, object>())
  const [states, setStates] = useState(new Map<string, SymlinkActivationState>())
  useLayoutEffect(() => {
    latestRef.current = args
  })
  useLayoutEffect(() => {
    setStates(new Map())
    const pending = pendingRef.current
    return () => {
      pending.clear()
    }
  }, [args.client, args.connected, args.scope])

  function setState(path: string, state?: SymlinkActivationState) {
    setStates((previous) => {
      const next = new Map(previous)
      if (state) {
        next.set(path, state)
      } else {
        next.delete(path)
      }
      return next
    })
  }

  async function activateSymlink(node: TreeNode) {
    const start = latestRef.current
    const path = node.relativePath
    if (pendingRef.current.has(path)) {
      return
    }
    if (!start.client || !start.connected || start.rootLoadInFlightRef.current) {
      setState(path, { error: 'Waiting for desktop. Try again after reconnecting.' })
      return
    }
    const parentPath = path.slice(0, Math.max(0, path.lastIndexOf('/')))
    const entry = getDirectoryCacheState(start.directoryCache, parentPath)?.entries.find(
      (item) => item.name === node.name
    )
    if (!entry?.isSymlink) {
      return
    }
    const generation = start.directoryLoadRevisionsRef.current.generation
    const owner = {}
    pendingRef.current.set(path, owner)
    setState(path, { loading: true })
    const isCurrent = () => {
      const current = latestRef.current
      return (
        pendingRef.current.get(path) === owner &&
        current.client === start.client &&
        current.connected &&
        current.scope === start.scope &&
        current.directoryLoadRevisionsRef.current.generation === generation &&
        getDirectoryCacheState(current.directoryCache, parentPath)?.entries.includes(entry)
      )
    }
    try {
      const response = await start.client.sendRequest('files.stat', {
        worktree: `id:${start.worktreeId}`,
        relativePath: path
      })
      if (!isCurrent()) {
        return
      }
      if (!response.ok) {
        throw new Error(
          isMobileMethodUnavailableError(response.error.code, response.error.message)
            ? 'Update Orca on the host to open symbolic links from mobile.'
            : response.error.message || 'Unable to open symbolic link'
        )
      }
      const result = response.result as { isDirectory: boolean }
      if (result.isDirectory) {
        start.setDirectoryCache((previous) => ({
          ...previous,
          [parentPath]: {
            ...getDirectoryCacheState(previous, parentPath),
            entries: (getDirectoryCacheState(previous, parentPath)?.entries ?? []).map((item) =>
              item === entry ? { ...item, isDirectory: true } : item
            )
          },
          [path]: undefined
        }))
        start.setExpanded((previous) => new Set(previous).add(path))
      } else if (
        node.kind !== 'directory' &&
        canPreviewMobileFileRow({ kind: node.kind, relativePath: path })
      ) {
        latestRef.current.previewFile(path, node.name)
      } else {
        throw new Error('This file type is unavailable on mobile.')
      }
      setState(path)
    } catch (error) {
      if (isCurrent()) {
        setState(path, {
          error: error instanceof Error ? error.message : 'Unable to open symbolic link'
        })
      }
    } finally {
      if (pendingRef.current.get(path) === owner) {
        pendingRef.current.delete(path)
        setStates((previous) => {
          if (!previous.get(path)?.loading) {
            return previous
          }
          const next = new Map(previous)
          next.delete(path)
          return next
        })
      }
    }
  }

  function toggleDirectory(path: string) {
    // Closing an ancestor cancels the click, even if it reopens before stat returns.
    for (const pendingPath of pendingRef.current.keys()) {
      if (pendingPath.startsWith(`${path}/`)) {
        pendingRef.current.delete(pendingPath)
        setState(pendingPath)
      }
    }
    args.toggleDirectory(path)
  }

  return { states, activateSymlink, toggleDirectory }
}
