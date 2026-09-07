import { createHash } from 'node:crypto'

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function parseDeviceDateEpochMs(output) {
  const text = String(output).trim()
  if (!/^\d{10,12}$/u.test(text)) {
    throw new Error('Device shell date +%s did not return epoch seconds')
  }
  const seconds = Number(text)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error('Device shell date +%s returned an invalid epoch')
  }
  return seconds * 1000
}

export function verifyHarmonyDeviceDateEpochSupport(command, hdc, target) {
  const help = command(hdc, target, ['shell', 'date', '--help'])
  if (!String(help).trim()) {
    throw new Error('Device shell date --help returned no output')
  }
  const startedAtMs = readHarmonyDeviceEpochMs(command, hdc, target)
  return {
    clock: {
      command: 'date +%s',
      helpSha256: sha256(help),
      source: 'device-shell',
      startEpochSeconds: Math.floor(startedAtMs / 1000),
      verifiedBeforeRun: true
    },
    startedAtMs
  }
}

export function readHarmonyDeviceEpochMs(command, hdc, target) {
  return parseDeviceDateEpochMs(command(hdc, target, ['shell', 'date', '+%s']))
}
