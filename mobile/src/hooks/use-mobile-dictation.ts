import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addExpoTwoWayAudioEventListener } from '@orca/expo-two-way-audio'
import { MobileDictationPendingAudioBudget } from './mobile-dictation-pending-audio-budget'
import { enqueueMobileDictationAudioChunk } from './mobile-dictation-audio-chunk'
import { createMobileDictationKeepAwakeOwner } from './mobile-dictation-keep-awake'
import { useMobileDictationForegroundKeepAwake } from './mobile-dictation-foreground-keep-awake'
import {
  DICTATION_FINISH_TIMEOUT_MS,
  createMobileDictationId,
  isCurrentMobileDictationOrigin,
  isCurrentMobileDictationFinish
} from './mobile-dictation-session-state'
import { startMobileDictationDesktopSession } from './mobile-dictation-desktop-start'
import {
  createMobileDictationMicrophoneStartAttempt,
  createMobileDictationMicrophoneOwner,
  prepareMobileDictationMicrophoneStart
} from './mobile-dictation-start-prerequisites'
import type {
  DictationStatus,
  MobileDictationOrigin,
  UseMobileDictationOptions,
  UseMobileDictationResult
} from './mobile-dictation-session-state'

export type { UseMobileDictationResult } from './mobile-dictation-session-state'

export function useMobileDictation(options: UseMobileDictationOptions): UseMobileDictationResult {
  const { client, enabled, scopeKey, onTranscript, onError } = options
  const keepAwakeOwner = useMemo(() => createMobileDictationKeepAwakeOwner(), [])
  const microphoneOwner = useMemo(() => createMobileDictationMicrophoneOwner(), [])
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const originRef = useRef<MobileDictationOrigin | null>(null)
  const clientRef = useRef(client)
  const scopeKeyRef = useRef(scopeKey)
  const enabledRef = useRef(enabled)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const pendingChunksRef = useRef<Set<Promise<void>>>(new Set())
  const pendingAudioBudgetRef = useRef(new MobileDictationPendingAudioBudget())
  const acceptingChunksRef = useRef(false)
  const generationRef = useRef(0)
  const finishingIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    // Native audio events can arrive before passive Effects flush, but refs
    // should only expose options from a committed render.
    clientRef.current = client
    scopeKeyRef.current = scopeKey
    enabledRef.current = enabled
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [client, enabled, scopeKey, onTranscript, onError])

  const reportError = useCallback((err: unknown) => {
    const normalized = err instanceof Error ? err : new Error(String(err))
    setError(normalized.message)
    setStatus('error')
    onErrorRef.current?.(normalized)
  }, [])

  const closeDictationAudio = useCallback(
    (dictationId?: string | null) => {
      acceptingChunksRef.current = false
      pendingChunksRef.current.clear()
      pendingAudioBudgetRef.current.reset()
      microphoneOwner.stopRecordingIfCurrent()
      void keepAwakeOwner.release(dictationId ?? undefined).catch(() => undefined)
    },
    [keepAwakeOwner, microphoneOwner]
  )

  const failActiveDictation = useCallback(
    (dictationId: string, err: unknown) => {
      const client = originRef.current?.client
      if (activeIdRef.current !== dictationId) {
        return
      }
      activeIdRef.current = null
      originRef.current = null
      closeDictationAudio(dictationId)
      if (client && dictationId) {
        void client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
      }
      reportError(err)
    },
    [closeDictationAudio, reportError]
  )

  useEffect(() => {
    // Microphone events are a hot path; reuse this wiring instead of allocating
    // a queue object and release predicate for every audio chunk.
    const audioChunkQueue = {
      pendingChunks: pendingChunksRef.current,
      pendingAudioBudget: pendingAudioBudgetRef.current,
      shouldReleaseBudget: (id: string) =>
        activeIdRef.current === id || finishingIdRef.current === id,
      failActiveDictation
    }
    const sub = addExpoTwoWayAudioEventListener('onMicrophoneData', (event) => {
      const origin = originRef.current
      const dictationId = activeIdRef.current
      if (
        !isCurrentMobileDictationOrigin(origin, clientRef.current, scopeKeyRef.current) ||
        !dictationId ||
        !enabledRef.current ||
        !acceptingChunksRef.current ||
        !microphoneOwner.isCurrent()
      ) {
        return
      }
      enqueueMobileDictationAudioChunk(origin.client, dictationId, event, audioChunkQueue)
    })
    return () => sub.remove()
  }, [failActiveDictation, microphoneOwner, reportError])

  const start = useCallback(async () => {
    const client = clientRef.current
    if (!client || !enabledRef.current || originRef.current) {
      return
    }

    const origin: MobileDictationOrigin = { client, scopeKey: scopeKeyRef.current }
    originRef.current = origin
    const generation = (generationRef.current += 1)
    const startAttempt = createMobileDictationMicrophoneStartAttempt()
    setError(null)
    setStatus('starting')
    try {
      const microphoneReady = await prepareMobileDictationMicrophoneStart({
        generation,
        getCurrentGeneration: () => generationRef.current,
        getEnabled: () => enabledRef.current,
        microphoneOwner,
        startAttempt,
        setIdle: () => setStatus('idle')
      })
      if (!microphoneReady) {
        return
      }

      const dictationId = createMobileDictationId()
      activeIdRef.current = dictationId

      await startMobileDictationDesktopSession({
        client,
        dictationId,
        generation,
        getCurrentGeneration: () => generationRef.current,
        getEnabled: () => enabledRef.current && microphoneOwner.isCurrent(),
        getActiveId: () => activeIdRef.current,
        clearActiveId: (id) => {
          if (activeIdRef.current === id) {
            activeIdRef.current = null
          }
        },
        setIdle: () => setStatus('idle'),
        keepAwakeOwner,
        commitRecordingStart: () => {
          acceptingChunksRef.current = true
          pendingChunksRef.current.clear()
          pendingAudioBudgetRef.current.reset()
          if (!microphoneOwner.startRecordingIfCurrent()) {
            return false
          }
          setStatus('recording')
          return true
        },
        rollbackRecordingStart: () => {
          acceptingChunksRef.current = false
          pendingChunksRef.current.clear()
          pendingAudioBudgetRef.current.reset()
          microphoneOwner.stopRecordingIfCurrent()
        }
      })
    } finally {
      if (originRef.current === origin && activeIdRef.current === null) {
        originRef.current = null
      }
    }
  }, [keepAwakeOwner, microphoneOwner])

  const stop = useCallback(async () => {
    const origin = originRef.current
    const dictationId = activeIdRef.current
    if (
      !isCurrentMobileDictationOrigin(origin, clientRef.current, scopeKeyRef.current) ||
      !dictationId
    ) {
      return
    }

    const generation = (generationRef.current += 1)
    finishingIdRef.current = dictationId
    setStatus('processing')
    acceptingChunksRef.current = false
    try {
      // Inside the try so a throwing native shutdown still runs the finally
      // release and error cleanup.
      microphoneOwner.stopRecordingIfCurrent()
      await Promise.allSettled(Array.from(pendingChunksRef.current))
      if (
        originRef.current !== origin ||
        !isCurrentMobileDictationFinish(
          generationRef.current,
          generation,
          enabledRef.current,
          activeIdRef.current,
          finishingIdRef.current,
          dictationId
        )
      ) {
        return
      }
      const response = await origin.client.sendRequest(
        'speech.dictation.finish',
        { dictationId },
        { timeoutMs: DICTATION_FINISH_TIMEOUT_MS }
      )
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      if (
        originRef.current !== origin ||
        !isCurrentMobileDictationFinish(
          generationRef.current,
          generation,
          enabledRef.current,
          activeIdRef.current,
          finishingIdRef.current,
          dictationId
        )
      ) {
        return
      }
      const result = response.result as { text?: unknown }
      const text = typeof result.text === 'string' ? result.text.trim() : ''
      activeIdRef.current = null
      originRef.current = null
      finishingIdRef.current = null
      pendingChunksRef.current.clear()
      pendingAudioBudgetRef.current.reset()
      setStatus('idle')
      if (text) {
        onTranscriptRef.current(text)
      } else {
        reportError(new Error('No speech detected.'))
      }
    } catch (err) {
      failActiveDictation(dictationId, err)
    } finally {
      // Hold the wake tag through chunk drain and the finish RPC: a screen
      // lock mid-processing suspends the app and loses the transcript.
      void keepAwakeOwner.release(dictationId).catch(() => undefined)
      if (finishingIdRef.current === dictationId) {
        finishingIdRef.current = null
      }
    }
  }, [failActiveDictation, keepAwakeOwner, microphoneOwner])

  const cancel = useCallback(async () => {
    const client = originRef.current?.client
    const dictationId = activeIdRef.current
    generationRef.current += 1
    activeIdRef.current = null
    originRef.current = null
    finishingIdRef.current = null
    closeDictationAudio(dictationId)
    setStatus('idle')
    setError(null)
    if (client && dictationId) {
      await client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
    }
  }, [closeDictationAudio])

  useLayoutEffect(() => {
    const origin = originRef.current
    if (origin && !isCurrentMobileDictationOrigin(origin, client, scopeKey)) {
      void cancel()
    }
  }, [client, scopeKey, cancel])

  useMobileDictationForegroundKeepAwake(keepAwakeOwner, activeIdRef, cancel)

  useEffect(() => {
    const sub = addExpoTwoWayAudioEventListener('onAudioInterruption', (event) => {
      if (event.data === 'began' || event.data === 'blocked') {
        void cancel()
      }
    })
    return () => sub.remove()
  }, [cancel])

  useEffect(() => {
    if (!enabled) {
      void cancel()
    }
  }, [cancel, enabled])

  useEffect(() => {
    return () => {
      const dictationId = activeIdRef.current
      const client = originRef.current?.client
      generationRef.current += 1
      activeIdRef.current = null
      originRef.current = null
      finishingIdRef.current = null
      closeDictationAudio(dictationId)
      microphoneOwner.tearDownIfCurrent()
      if (client && dictationId) {
        void client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
      }
    }
  }, [closeDictationAudio, microphoneOwner])

  return {
    status,
    isStarting: status === 'starting',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    error,
    start,
    stop,
    cancel
  }
}
