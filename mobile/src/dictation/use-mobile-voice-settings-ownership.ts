import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { setDictationConfig, type MobileSpeechSetup } from './mobile-dictation-setup'

export type VoiceConfigPatch = {
  enabled?: boolean
  modelId?: string
  dictationMode?: 'toggle' | 'hold'
}
type SetupSnapshot = { client: RpcClient; generation: number; value: MobileSpeechSetup }
type ErrorSnapshot = {
  client: RpcClient
  generation: number
  message: string
  kind: 'read' | 'mutation'
}

export function useMobileVoiceSettingsOwnership(client: RpcClient | null) {
  const committedClientRef = useRef<RpcClient | null>(null)
  const sourceGenerationRef = useRef(0)
  const revisionRef = useRef(0)
  const mutationWriteTailsRef = useRef(new Map<RpcClient, Promise<void>>())
  const pendingMutationsRef = useRef(new Map<RpcClient, Set<number>>())
  const [setupSnapshot, setSetupSnapshot] = useState<SetupSnapshot | null>(null)
  const [errorSnapshot, setErrorSnapshot] = useState<ErrorSnapshot | null>(null)
  const setup =
    setupSnapshot?.client === client && setupSnapshot.generation === sourceGenerationRef.current
      ? setupSnapshot.value
      : null
  const error =
    errorSnapshot?.client === client && errorSnapshot.generation === sourceGenerationRef.current
      ? errorSnapshot.message
      : null

  useLayoutEffect(() => {
    committedClientRef.current = client
    sourceGenerationRef.current += 1
    revisionRef.current += 1
    return () => {
      if (committedClientRef.current === client) {
        committedClientRef.current = null
        sourceGenerationRef.current += 1
        revisionRef.current += 1
      }
    }
  }, [client])

  const isCurrent = useCallback(
    (owner: RpcClient, revision: number) =>
      committedClientRef.current === owner && revisionRef.current === revision,
    []
  )
  const claimRead = useCallback((owner: RpcClient) => {
    if (committedClientRef.current !== owner) {
      return null
    }
    return {
      revision: revisionRef.current,
      mutationPendingAtStart: pendingMutationsRef.current.has(owner)
    }
  }, [])
  const hasPendingMutation = useCallback(
    (owner: RpcClient) => pendingMutationsRef.current.has(owner),
    []
  )
  const updateSetup = useCallback(
    (owner: RpcClient, update: (current: MobileSpeechSetup | null) => MobileSpeechSetup | null) => {
      if (committedClientRef.current !== owner) {
        return
      }
      const generation = sourceGenerationRef.current
      setSetupSnapshot((previous) => {
        if (committedClientRef.current !== owner || sourceGenerationRef.current !== generation) {
          return previous
        }
        const next = update(
          previous?.client === owner && previous.generation === generation ? previous.value : null
        )
        return next === null ? null : { client: owner, generation, value: next }
      })
    },
    []
  )
  const updateError = useCallback(
    (owner: RpcClient, message: string | null, kind: 'read' | 'mutation') => {
      if (committedClientRef.current !== owner) {
        return
      }
      const generation = sourceGenerationRef.current
      setErrorSnapshot((previous) => {
        if (committedClientRef.current !== owner || sourceGenerationRef.current !== generation) {
          return previous
        }
        if (
          kind === 'read' &&
          previous?.client === owner &&
          previous.generation === generation &&
          previous.kind === 'mutation'
        ) {
          return previous
        }
        return message === null ? null : { client: owner, generation, message, kind }
      })
    },
    []
  )
  const beginMutation = useCallback(
    (owner: RpcClient): number | null => {
      if (committedClientRef.current !== owner) {
        return null
      }
      const revision = revisionRef.current + 1
      revisionRef.current = revision
      const pending = pendingMutationsRef.current.get(owner) ?? new Set<number>()
      pending.add(revision)
      pendingMutationsRef.current.set(owner, pending)
      updateError(owner, null, 'mutation')
      return revision
    },
    [updateError]
  )
  const finishMutation = useCallback((owner: RpcClient, revision: number) => {
    const pending = pendingMutationsRef.current.get(owner)
    pending?.delete(revision)
    if (pending?.size === 0) {
      pendingMutationsRef.current.delete(owner)
    }
  }, [])
  const queueVoiceMutation = useCallback(
    <T>(owner: RpcClient, mutation: () => Promise<T>): Promise<T | null> => {
      const generation = sourceGenerationRef.current
      const previous = mutationWriteTailsRef.current.get(owner) ?? Promise.resolve()
      const request = previous.then(() =>
        committedClientRef.current === owner && sourceGenerationRef.current === generation
          ? mutation()
          : null
      )
      const tail = request.then(
        () => undefined,
        () => undefined
      )
      mutationWriteTailsRef.current.set(owner, tail)
      void tail.then(() => {
        if (mutationWriteTailsRef.current.get(owner) === tail) {
          mutationWriteTailsRef.current.delete(owner)
        }
      })
      return request
    },
    []
  )
  const queueConfigPatch = useCallback(
    (owner: RpcClient, patch: VoiceConfigPatch) =>
      queueVoiceMutation(owner, () => setDictationConfig(owner, patch)),
    [queueVoiceMutation]
  )

  return {
    setup,
    error,
    isCurrent,
    claimRead,
    hasPendingMutation,
    updateSetup,
    updateError,
    beginMutation,
    finishMutation,
    queueVoiceMutation,
    queueConfigPatch
  }
}
