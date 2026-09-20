import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { browserErrorMessage, shouldSurfaceBrowserError } from './mobile-browser-frame-state'
import type { BrowserRequestOptions } from './mobile-browser-interaction-contract'

type BrowserRequestArgs = {
  busyRef: { current: boolean }
  client: RpcClient | null
  commandFailedMessage: string
  pageId: string | null
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  worktreeId: string
}
export function useMobileBrowserRequest(args: BrowserRequestArgs) {
  const { busyRef, client, commandFailedMessage, pageId, setBusy, setError, worktreeId } = args
  const scopeRef = useRef({ client, pageId, worktreeId, generation: 0 })
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const busyRequestIdRef = useRef(0)
  const retirePendingFeedback = useCallback(() => {
    requestIdRef.current += 1
  }, [])
  if (
    scopeRef.current.client !== client ||
    scopeRef.current.pageId !== pageId ||
    scopeRef.current.worktreeId !== worktreeId
  ) {
    scopeRef.current = { client, pageId, worktreeId, generation: scopeRef.current.generation + 1 }
  }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const pageParams = useCallback(() => {
    if (!pageId) {
      return null
    }
    return {
      worktree: `id:${worktreeId}`,
      page: pageId
    }
  }, [pageId, worktreeId])

  const sendBrowserRequest = useCallback(
    async (
      method: string,
      params: Record<string, unknown> = {},
      opts: BrowserRequestOptions = {}
    ): Promise<unknown | null> => {
      const base = pageParams()
      if (
        !client ||
        !base ||
        !mountedRef.current ||
        scopeRef.current.client !== client ||
        scopeRef.current.pageId !== pageId ||
        scopeRef.current.worktreeId !== worktreeId
      ) {
        return null
      }
      const requestId = ++requestIdRef.current
      const generation = scopeRef.current.generation
      const isCurrentScope = () =>
        mountedRef.current &&
        scopeRef.current.generation === generation &&
        scopeRef.current.client === client
      const isLatestRequest = () => isCurrentScope() && requestIdRef.current === requestId
      const clearErrorIfCurrent = () => setError((current) => (isLatestRequest() ? null : current))
      if (opts.showBusy) {
        busyRequestIdRef.current = requestId
        busyRef.current = true
        setBusy(true)
      }
      try {
        const response = await client.sendRequest(
          method,
          { ...base, ...params },
          { timeoutMs: opts.timeoutMs ?? 15_000 }
        )
        if (!response.ok) {
          if (response.error.code === 'method_not_found' && opts.onUnsupportedMethod) {
            if (isCurrentScope()) {
              opts.onUnsupportedMethod(clearErrorIfCurrent)
            }
            return null
          }
          throw new Error((response as RpcFailure).error.message)
        }
        if (!isCurrentScope()) {
          return null
        }
        clearErrorIfCurrent()
        return (response as RpcSuccess).result
      } catch (err) {
        if (!isLatestRequest()) {
          return null
        }
        const message = browserErrorMessage(err, commandFailedMessage)
        if (!opts.suppressError && shouldSurfaceBrowserError(message)) {
          setError((current) => (isLatestRequest() ? message : current))
        }
        return null
      } finally {
        if (opts.showBusy && isCurrentScope() && busyRequestIdRef.current === requestId) {
          busyRef.current = false
          setBusy(false)
        }
      }
    },
    [client, commandFailedMessage, pageId, pageParams, worktreeId]
  )
  return { pageParams, retirePendingFeedback, sendBrowserRequest }
}
