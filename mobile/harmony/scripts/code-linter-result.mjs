import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export function listNativeLintSources(sourceRoot) {
  const sources = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const parts = relative(sourceRoot, path).split(sep)
      if (parts[0] === 'codegen' && parts[1] === 'generated') {
        continue
      }
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isFile() && entry.name.endsWith('.ets')) {
        sources.push(resolve(path))
      }
    }
  }
  visit(sourceRoot)
  return sources
}

export function inspectCodeLinterResult(result, expectedSources) {
  const defects = []
  const failures = new Set()
  const reportedSources = new Set()
  let reportCount = 0

  if (result.error) {
    failures.add(`DevEco Code Linter failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    failures.add(`DevEco Code Linter exited with status ${result.status ?? 'unknown'}`)
  }

  for (const [stream, output] of [
    ['stdout', result.stdout],
    ['stderr', result.stderr]
  ]) {
    for (const line of (output ?? '').split('\n')) {
      if (!line.trim()) {
        continue
      }
      let report
      try {
        report = JSON.parse(line)
      } catch {
        failures.add(`DevEco Code Linter emitted non-JSON ${stream} output: ${line.slice(0, 500)}`)
        continue
      }
      if (!report || typeof report !== 'object' || Array.isArray(report)) {
        failures.add(
          `DevEco Code Linter emitted a malformed ${stream} record: ${line.slice(0, 500)}`
        )
        continue
      }
      if ('defects' in report || 'filePath' in report) {
        if (typeof report.filePath !== 'string' || !report.filePath.trim()) {
          failures.add('DevEco Code Linter returned a report without a file path')
          continue
        }
        if (!Array.isArray(report.defects)) {
          failures.add(`DevEco Code Linter returned malformed defects for ${report.filePath}`)
          continue
        }
        const malformedDefect = report.defects.findIndex(
          (defect) =>
            !defect ||
            typeof defect !== 'object' ||
            Array.isArray(defect) ||
            !Number.isInteger(defect.severity)
        )
        if (malformedDefect !== -1) {
          failures.add(
            `DevEco Code Linter returned malformed defect ${malformedDefect} for ${report.filePath}`
          )
          continue
        }
        reportCount += 1
        reportedSources.add(resolve(report.filePath))
        defects.push(...report.defects)
      } else if ([0, -1, -2, -4].includes(report.messageType)) {
        failures.add(String(report.content ?? `Code Linter error ${report.messageType}`))
      } else if (report.messageType !== 1 && report.messageType !== -3) {
        failures.add(`DevEco Code Linter emitted an unknown ${stream} record: ${line}`)
      }
    }
  }

  if (reportCount === 0) {
    failures.add('DevEco Code Linter returned no file reports')
  }
  if (expectedSources.length === 0) {
    failures.add('No ArkTS sources were found for Code Linter verification')
  }
  const missing = expectedSources.filter((source) => !reportedSources.has(resolve(source)))
  if (missing.length > 0) {
    failures.add(
      `DevEco Code Linter omitted ${missing.length} ArkTS source reports: ${missing.slice(0, 5).join(', ')}`
    )
  }
  if (defects.some((defect) => defect.severity === 2)) {
    failures.add('DevEco Code Linter found error-severity defects')
  }

  return {
    defects,
    failures: [...failures],
    reportCount,
    sourceCount: expectedSources.length
  }
}
