import { useCallback, useLayoutEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  deleteDictationModel,
  downloadDictationModel,
  fetchDictationSetup,
  isModelInFlight,
  type MobileSpeechModel
} from './mobile-dictation-setup'
import { useDictationSetupPoller } from './use-dictation-setup-poller'
import {
  useMobileVoiceSettingsOwnership,
  type VoiceConfigPatch
} from './use-mobile-voice-settings-ownership'

const POLL_INTERVAL_MS = 1500

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }
type BusySnapshot = { client: RpcClient; revision: number; action: ModelBusyAction }

export function useMobileVoiceSettingsState(client: RpcClient | null, routeFocused: boolean) {
  const {
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
  } = useMobileVoiceSettingsOwnership(client)
  const [busySnapshot, setBusySnapshot] = useState<BusySnapshot | null>(null)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const busyAction =
    busySnapshot && isCurrent(busySnapshot.client, busySnapshot.revision)
      ? busySnapshot.action
      : null
  const loading = routeFocused && client !== null && setup === null && error === null

  useLayoutEffect(() => setModelDrawerOpen(false), [client])

  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!client) {
      return false
    }
    const claim = claimRead(client)
    if (!claim) {
      return false
    }
    const { revision, mutationPendingAtStart } = claim
    try {
      const next = await fetchDictationSetup(client)
      if (!isCurrent(client, revision) || mutationPendingAtStart || hasPendingMutation(client)) {
        return undefined
      }
      updateSetup(client, () => next)
      updateError(client, null, 'read')
      return next.models.some(isModelInFlight)
    } catch (err) {
      if (isCurrent(client, revision) && !mutationPendingAtStart && !hasPendingMutation(client)) {
        updateError(
          client,
          err instanceof Error ? err.message : 'Failed to load voice settings',
          'read'
        )
      }
      return undefined
    }
  }, [claimRead, client, hasPendingMutation, isCurrent, updateError, updateSetup])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: routeFocused && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS,
    source: client
  })

  const updateConfig = async (patch: Pick<VoiceConfigPatch, 'enabled' | 'dictationMode'>) => {
    if (!client) {
      return
    }
    const revision = beginMutation(client)
    if (revision === null) {
      return
    }
    updateSetup(client, (previous) => (previous ? { ...previous, ...patch } : previous))
    try {
      const next = await queueConfigPatch(client, patch)
      if (next && isCurrent(client, revision)) {
        updateSetup(client, () => next)
      }
    } catch (err) {
      if (isCurrent(client, revision)) {
        updateError(client, err instanceof Error ? err.message : 'Could not update', 'mutation')
        finishMutation(client, revision)
        void refreshSetup()
      }
    } finally {
      finishMutation(client, revision)
    }
  }
  const handleToggleEnabled = (enabled: boolean) => updateConfig({ enabled })
  const handleSelectMode = (dictationMode: 'toggle' | 'hold') => updateConfig({ dictationMode })

  const handleUseModel = async (model: MobileSpeechModel) => {
    if (!client) {
      return
    }
    const revision = beginMutation(client)
    if (revision === null) {
      return
    }
    setBusySnapshot({
      client,
      revision,
      action: { modelId: model.id, type: 'select' }
    })
    try {
      const next = await queueConfigPatch(client, { enabled: true, modelId: model.id })
      if (next && isCurrent(client, revision)) {
        updateSetup(client, () => next)
        setModelDrawerOpen(false)
      }
    } catch (err) {
      if (isCurrent(client, revision)) {
        updateError(
          client,
          err instanceof Error ? err.message : 'Could not select model',
          'mutation'
        )
      }
    } finally {
      finishMutation(client, revision)
      if (isCurrent(client, revision)) {
        setBusySnapshot(null)
      }
    }
  }

  const handleDownload = async (model: MobileSpeechModel) => {
    if (!client) {
      return
    }
    const revision = beginMutation(client)
    if (revision === null) {
      return
    }
    setBusySnapshot({
      client,
      revision,
      action: { modelId: model.id, type: 'download' }
    })
    try {
      await queueVoiceMutation(client, () => downloadDictationModel(client, model.id))
      if (isCurrent(client, revision)) {
        finishMutation(client, revision)
        await refreshSetup()
      }
    } catch (err) {
      if (isCurrent(client, revision)) {
        updateError(client, err instanceof Error ? err.message : 'Download failed', 'mutation')
      }
    } finally {
      finishMutation(client, revision)
      if (isCurrent(client, revision)) {
        setBusySnapshot(null)
      }
    }
  }

  const handleDelete = async (model: MobileSpeechModel) => {
    if (!client) {
      return
    }
    const revision = beginMutation(client)
    if (revision === null) {
      return
    }
    const deletedSelectedModel = setup?.selectedModelId === model.id
    setBusySnapshot({
      client,
      revision,
      action: { modelId: model.id, type: 'delete' }
    })
    try {
      const next = await queueVoiceMutation(client, () => deleteDictationModel(client, model.id))
      if (next && isCurrent(client, revision)) {
        updateSetup(client, () => next)
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      }
    } catch (err) {
      if (isCurrent(client, revision)) {
        updateError(client, err instanceof Error ? err.message : 'Delete failed', 'mutation')
      }
    } finally {
      finishMutation(client, revision)
      if (isCurrent(client, revision)) {
        setBusySnapshot(null)
      }
    }
  }

  return {
    setup,
    loading,
    error,
    busyAction,
    modelDrawerOpen,
    setModelDrawerOpen,
    handleToggleEnabled,
    handleSelectMode,
    handleUseModel,
    handleDownload,
    handleDelete
  }
}
