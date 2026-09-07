const MISSING_PACKAGE_MESSAGES = [
  'package is not installed',
  'package not installed',
  'package not found',
  'package does not exist',
  'bundle is not installed',
  'bundle not installed',
  'bundle not found',
  'bundle does not exist',
  'no such package',
  'unknown package'
]
const UNINSTALL_FAILURE_MESSAGES = [
  'permission denied',
  'access denied',
  'uninstall failed',
  'error:'
]

export const isExpectedUninstallAbsentOutput = (output) => {
  const normalized = String(output).toLowerCase()
  return (
    !UNINSTALL_FAILURE_MESSAGES.some((message) => normalized.includes(message)) &&
    MISSING_PACKAGE_MESSAGES.some((message) => normalized.includes(message))
  )
}

export function cleanupHarmonyAcceptanceTarget(
  command,
  hdc,
  target,
  remoteDirectory,
  shouldUninstall
) {
  try {
    command(hdc, target, ['shell', 'rm', '-rf', remoteDirectory])
  } finally {
    try {
      command(hdc, target, ['shell', 'aa', 'force-stop', 'ai.stably.orca.harmony'])
    } catch {
      // Preserve the original acceptance failure when force-stop is unavailable.
    }
    if (shouldUninstall) {
      command(hdc, target, ['uninstall', 'ai.stably.orca.harmony'])
    }
  }
}
