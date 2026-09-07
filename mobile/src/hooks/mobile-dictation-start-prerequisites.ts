import {
  initialize,
  requestMicrophonePermissionsAsync,
  tearDown,
  toggleRecording
} from '@orca/expo-two-way-audio'

type MobileDictationStartPrerequisiteOptions = {
  generation: number
  getCurrentGeneration: () => number
  getEnabled: () => boolean
  microphoneOwner: MobileDictationMicrophoneOwner
  startAttempt: number
  setIdle: () => void
}
type MicrophonePermission = Awaited<ReturnType<typeof requestMicrophonePermissionsAsync>>

let nextStartAttempt = 0
let nextMicrophoneOwner = 0
let latestInitializeAttempt = 0
let currentMicrophoneOwner: number | null = null

export type MobileDictationMicrophoneOwner = {
  claimInitializeAttempt: (startAttempt: number) => boolean
  isCurrent: () => boolean
  startRecordingIfCurrent: () => boolean
  stopRecordingIfCurrent: () => void
  tearDownAfterInitializeIfCurrent: (startAttempt: number) => void
  tearDownIfCurrent: () => void
}

export function createMobileDictationMicrophoneStartAttempt(): number {
  nextStartAttempt += 1
  return nextStartAttempt
}

export function createMobileDictationMicrophoneOwner(): MobileDictationMicrophoneOwner {
  nextMicrophoneOwner += 1
  const owner = nextMicrophoneOwner
  return {
    claimInitializeAttempt(startAttempt) {
      if (startAttempt < latestInitializeAttempt) {
        return false
      }
      latestInitializeAttempt = startAttempt
      currentMicrophoneOwner = owner
      return true
    },
    isCurrent() {
      return currentMicrophoneOwner === owner
    },
    startRecordingIfCurrent() {
      return currentMicrophoneOwner === owner && toggleRecording(true)
    },
    stopRecordingIfCurrent() {
      if (currentMicrophoneOwner !== owner) {
        return
      }
      try {
        toggleRecording(false)
      } catch (err) {
        // Cleanup must keep going when native recording shutdown throws, or
        // the wake tag and dictation state would leak.
        console.error('Failed to stop microphone recording', err)
      }
    },
    tearDownAfterInitializeIfCurrent(startAttempt) {
      if (latestInitializeAttempt !== startAttempt || currentMicrophoneOwner !== owner) {
        return
      }
      tearDownMicrophone()
      releaseMicrophoneOwner(owner)
    },
    tearDownIfCurrent() {
      if (currentMicrophoneOwner !== owner) {
        return
      }
      tearDownMicrophone()
      releaseMicrophoneOwner(owner)
    }
  }
}

function releaseMicrophoneOwner(owner: number): void {
  if (currentMicrophoneOwner === owner) {
    currentMicrophoneOwner = null
  }
}

function resetIfStartCurrent(options: MobileDictationStartPrerequisiteOptions): boolean {
  if (options.getCurrentGeneration() !== options.generation) {
    return false
  }
  options.setIdle()
  return options.getEnabled()
}

function isStartStale(options: MobileDictationStartPrerequisiteOptions): boolean {
  if (options.getCurrentGeneration() === options.generation && options.getEnabled()) {
    return false
  }
  if (options.getCurrentGeneration() === options.generation) {
    options.setIdle()
  }
  return true
}

function isMicrophoneOwnerStale(options: MobileDictationStartPrerequisiteOptions): boolean {
  if (options.microphoneOwner.isCurrent()) {
    return false
  }
  if (options.getCurrentGeneration() === options.generation) {
    options.setIdle()
  }
  return true
}

function tearDownMicrophone(): void {
  try {
    tearDown()
  } catch {
    // Preserve the startup failure that tells the caller what went wrong.
  }
}

export async function prepareMobileDictationMicrophoneStart(
  options: MobileDictationStartPrerequisiteOptions
): Promise<boolean> {
  let permission: MicrophonePermission
  try {
    permission = await requestMicrophonePermissionsAsync()
  } catch (err) {
    if (resetIfStartCurrent(options)) {
      throw err
    }
    return false
  }
  if (isStartStale(options)) {
    return false
  }
  if (!permission.granted) {
    options.setIdle()
    throw new Error('Microphone permission denied')
  }

  let initialized: boolean
  if (!options.microphoneOwner.claimInitializeAttempt(options.startAttempt)) {
    isMicrophoneOwnerStale(options)
    return false
  }
  try {
    initialized = await initialize()
  } catch (err) {
    if (isMicrophoneOwnerStale(options)) {
      return false
    }
    options.microphoneOwner.tearDownAfterInitializeIfCurrent(options.startAttempt)
    if (resetIfStartCurrent(options)) {
      throw err
    }
    return false
  }
  if (isMicrophoneOwnerStale(options)) {
    return false
  }
  if (isStartStale(options)) {
    options.microphoneOwner.tearDownAfterInitializeIfCurrent(options.startAttempt)
    return false
  }
  if (!initialized) {
    options.setIdle()
    throw new Error('Failed to initialize microphone')
  }
  return true
}
