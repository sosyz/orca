import { CLEAN_INSTALL_MODE, PRESERVE_DATA_MODE } from './harmony-simulator-acceptance-mode.mjs'

export const HILOG_TIME_WINDOW_ALLOWANCE_MS = 5_000

function fractionalSecondsToMs(value) {
  if (!value) {
    return 0
  }
  return Number(value.padEnd(3, '0').slice(0, 3))
}

export function parseHilogTimestampMs(line) {
  const text = String(line)
  const epochMilliseconds = text.match(/^\s*\[?(\d{13})(?:[.,](\d{1,6}))?\]?(?=\s|$)/u)
  if (epochMilliseconds) {
    return Number(epochMilliseconds[1])
  }
  const epochSeconds = text.match(/^\s*\[?(\d{10})(?:[.,](\d{1,9}))?\]?(?=\s|$)/u)
  if (epochSeconds) {
    return Number(epochSeconds[1]) * 1000 + fractionalSecondsToMs(epochSeconds[2])
  }
  return undefined
}

export function parseHilogEpochPidLine(line) {
  const text = String(line)
  const match = text.match(/^\s*\[?(\d{13}|\d{10})(?:[.,](\d{1,9}))?\]?\s+(\d+)\s+\d+\s+/u)
  if (!match) {
    return undefined
  }
  const timestampMs =
    match[1].length === 13
      ? Number(match[1])
      : Number(match[1]) * 1000 + fractionalSecondsToMs(match[2])
  return {
    pid: match[3],
    timestampMs
  }
}

export function scopeHilogToPidEpochWindow(
  log,
  { allowanceMs = HILOG_TIME_WINDOW_ALLOWANCE_MS, completedAtMs, pids, startedAtMs }
) {
  const lines = String(log).split(/\r?\n/u).filter(Boolean)
  const kept = []
  const pidSet = new Set(pids.map(String))
  const result = {
    droppedAfterWindowLineCount: 0,
    droppedBeforeWindowLineCount: 0,
    rawLineCount: lines.length,
    unexpectedPidLineCount: 0,
    unverifiableLineCount: 0,
    keptLineCount: 0,
    text: ''
  }
  for (const line of lines) {
    const parsed = parseHilogEpochPidLine(line)
    if (!parsed) {
      result.unverifiableLineCount += 1
      continue
    }
    if (!pidSet.has(parsed.pid)) {
      result.unexpectedPidLineCount += 1
      continue
    }
    if (parsed.timestampMs < startedAtMs - allowanceMs) {
      result.droppedBeforeWindowLineCount += 1
      continue
    }
    if (parsed.timestampMs > completedAtMs + allowanceMs) {
      result.droppedAfterWindowLineCount += 1
      continue
    }
    kept.push(line)
  }
  result.keptLineCount = kept.length
  result.text = kept.join('\n')
  return result
}

export function assertPreserveDataHilogScopeResult(result) {
  if (result.rawLineCount === 0) {
    throw new Error('Preserve-data hilog returned no PID-scoped lines; logs are unverifiable')
  }
  if (result.unverifiableLineCount > 0) {
    throw new Error('Preserve-data hilog contains non-epoch or unknown PID-format lines')
  }
  if (result.unexpectedPidLineCount > 0) {
    throw new Error('Preserve-data hilog contains lines outside the requested PIDs')
  }
  if (result.keptLineCount === 0) {
    throw new Error('Preserve-data hilog retained no lines inside the device clock window')
  }
}

export function hilogReadArgsForAcceptanceMode(mode, pids) {
  const pidList = [...new Set(pids.map(String).filter(Boolean))].join(',')
  if (mode === PRESERVE_DATA_MODE) {
    return ['shell', 'hilog', '-v', 'epoch', '-x', '-P', pidList]
  }
  return ['shell', 'hilog', '-x', '-P', pidList]
}

export function hilogScopeEvidenceForAcceptanceMode({
  completedAtMs,
  mode,
  startedAtMs,
  timeWindowResult
}) {
  const timeWindowed = mode === PRESERVE_DATA_MODE
  return {
    bounded: true,
    completedAt: new Date(completedAtMs).toISOString(),
    globalBufferCleared: mode === CLEAN_INSTALL_MODE,
    pidFiltered: true,
    readMode: 'non-blocking',
    startedAt: new Date(startedAtMs).toISOString(),
    timeWindow: timeWindowed
      ? {
          droppedAfterWindowLineCount: timeWindowResult?.droppedAfterWindowLineCount ?? 0,
          droppedBeforeWindowLineCount: timeWindowResult?.droppedBeforeWindowLineCount ?? 0,
          enabled: true,
          keptLineCount: timeWindowResult?.keptLineCount ?? 0,
          rawLineCount: timeWindowResult?.rawLineCount ?? 0,
          skewAllowanceMs: HILOG_TIME_WINDOW_ALLOWANCE_MS,
          timestampFormat: 'epoch',
          unexpectedPidLineCount: timeWindowResult?.unexpectedPidLineCount ?? 0,
          unverifiableLineCount: timeWindowResult?.unverifiableLineCount ?? 0
        }
      : { enabled: false }
  }
}
