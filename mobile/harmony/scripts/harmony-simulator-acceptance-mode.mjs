export const CLEAN_INSTALL_MODE = 'clean-install'
export const PRESERVE_DATA_MODE = 'preserve-data'
export const HARMONY_SIMULATOR_ACCEPTANCE_MODES = Object.freeze([
  CLEAN_INSTALL_MODE,
  PRESERVE_DATA_MODE
])

export function parseHarmonySimulatorAcceptanceMode(value) {
  const mode = String(value ?? '').trim()
  if (HARMONY_SIMULATOR_ACCEPTANCE_MODES.includes(mode)) {
    return mode
  }
  const expectedModes = HARMONY_SIMULATOR_ACCEPTANCE_MODES.join(' or ')
  throw new Error(
    `Unsupported Harmony simulator acceptance mode: ${mode || '<empty>'}; expected ${expectedModes}`
  )
}

export function resolveHarmonySimulatorAcceptanceMode({
  mode = CLEAN_INSTALL_MODE,
  modeWasSpecified = false,
  skipInstall = false
} = {}) {
  const parsedMode = parseHarmonySimulatorAcceptanceMode(mode)
  if (!skipInstall) {
    return parsedMode
  }
  if (modeWasSpecified && parsedMode !== PRESERVE_DATA_MODE) {
    throw new Error('--skip-install cannot be used with --mode clean-install')
  }
  return PRESERVE_DATA_MODE
}

export function harmonySimulatorAcceptanceModePolicy(mode) {
  const parsedMode = parseHarmonySimulatorAcceptanceMode(mode)
  const cleanInstall = parsedMode === CLEAN_INSTALL_MODE
  return {
    clearGlobalHilogBeforeRun: cleanInstall,
    cleanInstall,
    installHap: cleanInstall,
    mode: parsedMode,
    publishableCleanAcceptance: cleanInstall,
    uninstallAfterRun: cleanInstall,
    uninstallBeforeInstall: cleanInstall
  }
}

export function harmonySimulatorAcceptanceModeEvidence(mode) {
  const policy = harmonySimulatorAcceptanceModePolicy(mode)
  return {
    cleanInstall: policy.cleanInstall,
    dataPolicy: {
      appCleanup: policy.cleanInstall
        ? 'uninstall-installed-hap-after-run'
        : 'preserve-existing-install',
      appInstall: policy.cleanInstall
        ? 'uninstall-then-install-exact-hap'
        : 'preserve-existing-install',
      globalHilog: policy.cleanInstall ? 'cleared-before-run' : 'not-cleared',
      logScope: policy.cleanInstall
        ? 'pid-filtered-after-global-clear'
        : 'pid-filtered-and-time-windowed'
    },
    mode: policy.mode,
    publishableCleanAcceptance: policy.publishableCleanAcceptance
  }
}
