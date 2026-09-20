import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react'
import * as Clipboard from 'expo-clipboard'
import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/diff-comment-types'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { formatDiffComments, formatMobileDiffReviewPrompt } from './mobile-diff-comments'
import { clearSentMobileDiffComments } from './mobile-diff-comment-edit'
import {
  readMobileReviewCreatedTerminal,
  readMobileReviewTerminalSendAccepted,
  readMobileReviewTerminalTabs
} from './mobile-diff-review-rpc'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'
import type { ReviewScreenState, SendSheetState } from './mobile-diff-review-screen-model'

type SendActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  screenState: ReviewScreenState
  setActionError: Dispatch<SetStateAction<string | null>>
  setSendSheet: Dispatch<SetStateAction<SendSheetState | null>>
  saveCommentsAndReviewState: (
    comments: DiffComment[],
    reviewState: MobileDiffReviewState
  ) => Promise<boolean | void>
  markSentComments: (comments: readonly DiffComment[]) => Promise<boolean>
}

class ReviewNotesStateSaveError extends Error {}

export function useMobileDiffReviewSendActions(input: SendActionsInput) {
  const {
    client,
    connState,
    worktreeId,
    screenState,
    setActionError,
    setSendSheet,
    saveCommentsAndReviewState,
    markSentComments
  } = input
  const scope = useMemo(() => ({ client, worktreeId }), [client, worktreeId])
  const currentScopeRef = useRef<{ client: RpcClient | null; worktreeId: string } | null>(null)
  const pendingSendOwnersRef = useRef(new Set<{ client: RpcClient; worktreeId: string }>())
  const sheetRequestRef = useRef(0)
  const [, refreshSendBusy] = useReducer((revision: number) => revision + 1, 0)
  useLayoutEffect(() => {
    currentScopeRef.current = scope
    return () => {
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null
      }
    }
  }, [scope])
  const isCurrentScope = useCallback(() => currentScopeRef.current === scope, [scope])
  const beginSend = useCallback(() => {
    if (!client || connState !== 'connected') {
      if (isCurrentScope()) {
        setActionError('Waiting for desktop...')
      }
      throw new Error('Waiting for desktop...')
    }
    if (!isCurrentScope()) {
      return null
    }
    for (const owner of pendingSendOwnersRef.current) {
      if (owner.client === client && owner.worktreeId === worktreeId) {
        return null
      }
    }
    const owner = { client, worktreeId }
    pendingSendOwnersRef.current.add(owner)
    refreshSendBusy()
    setActionError(null)
    return owner
  }, [client, connState, isCurrentScope, setActionError, worktreeId])
  const finishSend = useCallback((owner: { client: RpcClient; worktreeId: string }) => {
    pendingSendOwnersRef.current.delete(owner)
    if (currentScopeRef.current) {
      refreshSendBusy()
    }
  }, [])

  const copyNotes = useCallback(async () => {
    if (screenState.kind !== 'ready' || screenState.comments.length === 0) {
      return
    }
    try {
      await Clipboard.setStringAsync(formatDiffComments(screenState.comments))
      triggerSuccess()
      setActionError('Review notes copied')
    } catch (err) {
      triggerError()
      setActionError(err instanceof Error ? err.message : "Couldn't copy review notes")
    }
  }, [screenState, setActionError])

  const clearSentNotes = useCallback(async () => {
    if (screenState.kind !== 'ready') {
      return
    }
    const nextComments = clearSentMobileDiffComments(screenState.comments)
    await saveCommentsAndReviewState(nextComments, screenState.reviewState)
  }, [saveCommentsAndReviewState, screenState])

  const sendPromptToTerminalCore = useCallback(
    async (terminal: string, comments: readonly DiffComment[]) => {
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      // Marked by terminal handle, not by surface, so a paste orphaned here by native
      // chat would ride along with these notes (#10228). Diff review carries no device token.
      if (!(await healMobileNativeChatStaleInput({ client, terminal, deviceToken: null }))) {
        throw new Error('Failed to send notes')
      }
      if (!isCurrentScope()) {
        return
      }
      const response = await client.sendRequest('terminal.send', {
        terminal,
        text: formatMobileDiffReviewPrompt(comments),
        enter: true
      })
      if (!isCurrentScope()) {
        return
      }
      if (!response.ok) {
        throw new Error(response.error?.message || 'Failed to send notes')
      }
      if (!readMobileReviewTerminalSendAccepted(response.result)) {
        throw new Error('Terminal input is locked')
      }
      let marked: boolean
      try {
        marked = await markSentComments(comments)
      } catch {
        throw new ReviewNotesStateSaveError(
          'Notes were sent, but review state could not be saved. Check delivery before sending again.'
        )
      }
      if (!marked) {
        return
      }
      if (!isCurrentScope()) {
        return
      }
      triggerSuccess()
      setActionError('Review notes sent')
      setSendSheet(null)
    },
    [client, connState, isCurrentScope, markSentComments, setActionError, setSendSheet]
  )

  const sendPromptToTerminal = useCallback(
    async (terminal: string, comments: readonly DiffComment[]) => {
      const owner = beginSend()
      if (!owner) {
        return
      }
      try {
        await sendPromptToTerminalCore(terminal, comments)
      } catch (err) {
        if (isCurrentScope()) {
          setActionError(err instanceof Error ? err.message : 'Failed to send notes')
        }
        throw err
      } finally {
        finishSend(owner)
      }
    },
    [beginSend, finishSend, isCurrentScope, sendPromptToTerminalCore, setActionError]
  )

  const createTerminalAndSend = useCallback(
    async (comments: readonly DiffComment[]) => {
      const owner = beginSend()
      if (!owner) {
        return
      }
      let created: ReturnType<typeof readMobileReviewCreatedTerminal> = null
      try {
        const response = await owner.client.sendRequest('session.tabs.createTerminal', {
          worktree: `id:${owner.worktreeId}`,
          activate: false,
          select: true,
          navigation: 'caller'
        })
        if (!isCurrentScope()) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error?.message || 'Failed to create terminal')
        }
        created = readMobileReviewCreatedTerminal(response.result)
        if (!created) {
          throw new Error('Created terminal response was invalid')
        }
        const createdTerminal = created
        setSendSheet((current) => {
          if (!current) {
            return current
          }
          const terminals = current.kind === 'loading' ? [] : current.terminals
          return {
            kind: 'ready',
            terminals: terminals.some((terminal) => terminal.id === createdTerminal.id)
              ? terminals
              : [...terminals, createdTerminal]
          }
        })
        await sendPromptToTerminalCore(created.terminal, comments)
      } catch (err) {
        if (isCurrentScope()) {
          const message = err instanceof Error ? err.message : 'Failed to send notes'
          setActionError(
            created && !(err instanceof ReviewNotesStateSaveError)
              ? `${message}. Terminal ${created.title} was created; select it to retry after checking delivery.`
              : message
          )
        }
        throw err
      } finally {
        finishSend(owner)
      }
    },
    [beginSend, finishSend, isCurrentScope, sendPromptToTerminalCore, setActionError, setSendSheet]
  )

  const openSendSheet = useCallback(async () => {
    const scope = currentScopeRef.current
    if (!isCurrentScope() || !scope) {
      return
    }
    if (!client || connState !== 'connected') {
      setActionError('Waiting for desktop...')
      return
    }
    const requestId = ++sheetRequestRef.current
    setSendSheet({ kind: 'loading' })
    try {
      const response = await client.sendRequest('session.tabs.list', {
        worktree: `id:${worktreeId}`
      })
      if (currentScopeRef.current !== scope || sheetRequestRef.current !== requestId) {
        return
      }
      if (!response.ok) {
        throw new Error(response.error?.message || 'Unable to load agent sessions')
      }
      setSendSheet({ kind: 'ready', terminals: readMobileReviewTerminalTabs(response.result) })
    } catch (err) {
      if (currentScopeRef.current !== scope || sheetRequestRef.current !== requestId) {
        return
      }
      setSendSheet({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to load agent sessions',
        terminals: []
      })
    }
  }, [client, connState, isCurrentScope, setActionError, setSendSheet, worktreeId])

  return {
    clearSentNotes,
    copyNotes,
    createTerminalAndSend,
    openSendSheet,
    sendBusy: [...pendingSendOwnersRef.current].some(
      (owner) => owner.client === client && owner.worktreeId === worktreeId
    ),
    sendPromptToTerminal
  }
}
