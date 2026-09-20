import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inspectCodeLinterResult, listNativeLintSources } from './code-linter-result.mjs'

const sources = ['/project/a.ets', '/project/native/b.ets']
const report = (filePath, defects = []) => JSON.stringify({ filePath, defects })
const complete = () => ({
  status: 0,
  stdout: `${report(sources[0])}\n${report(sources[1])}\n`,
  stderr: `${JSON.stringify({ messageType: -3, content: 'config loaded' })}\n${JSON.stringify({ messageType: 1, content: 'report finish' })}\n`
})

test('accepts a complete, defect-free Code Linter result', () => {
  const result = inspectCodeLinterResult(complete(), sources)
  assert.equal(result.reportCount, 2)
  assert.deepEqual(result.failures, [])
})

test('fails when DevEco reports incomplete results despite status zero and file reports', () => {
  const output = complete()
  output.stderr += `${JSON.stringify({
    messageType: 0,
    content: 'Some error occurred during linting. This may cause incomplete report results.'
  })}\n`

  const result = inspectCodeLinterResult(output, sources)
  assert.match(result.failures.join('\n'), /incomplete report results/u)
})

test('fails when a source report is missing without an explicit DevEco error', () => {
  const output = complete()
  output.stdout = `${report(sources[0])}\n`

  const result = inspectCodeLinterResult(output, sources)
  assert.match(result.failures.join('\n'), /omitted 1 ArkTS source reports/u)
})

test('fails on a Code Linter warning even when every source has a report', () => {
  const output = complete()
  output.stderr += `${JSON.stringify({ messageType: -2, content: 'one agent skipped checks' })}\n`

  const result = inspectCodeLinterResult(output, sources)
  assert.ok(result.failures.includes('one agent skipped checks'))
})

test('fails on malformed protocol output, nonzero exit, and error defects', () => {
  const output = complete()
  output.status = 1
  output.stdout += 'unparseable native error\n'
  output.stdout += `${report('/project', [{ severity: 2, description: 'bad code' }])}\n`

  const result = inspectCodeLinterResult(output, sources)
  assert.match(result.failures.join('\n'), /exited with status 1/u)
  assert.match(result.failures.join('\n'), /non-JSON stdout output/u)
  assert.match(result.failures.join('\n'), /error-severity defects/u)
})

test('fails closed on JSON records with invalid report or defect shapes', () => {
  const output = complete()
  output.stdout += 'null\n[]\n'
  output.stdout += `${JSON.stringify({ filePath: '/project/c.ets', defects: null })}\n`
  output.stdout += `${report('/project/d.ets', [null])}\n`
  output.stdout += `${report('/project/e.ets', [{}])}\n`

  const result = inspectCodeLinterResult(output, sources)
  assert.equal(result.reportCount, 2)
  assert.match(result.failures.join('\n'), /malformed stdout record/u)
  assert.match(result.failures.join('\n'), /malformed defects for \/project\/c\.ets/u)
  assert.match(result.failures.join('\n'), /malformed defect 0 for \/project\/d\.ets/u)
  assert.match(result.failures.join('\n'), /malformed defect 0 for \/project\/e\.ets/u)
})

test('requires checks for source files while honoring the generated-code exclusion', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-linter-sources-'))
  try {
    mkdirSync(join(root, 'native'))
    mkdirSync(join(root, 'codegen', 'generated'), { recursive: true })
    writeFileSync(join(root, 'native', 'Service.ets'), '')
    writeFileSync(join(root, 'codegen', 'generated', 'index.ets'), '')

    assert.deepEqual(listNativeLintSources(root), [join(root, 'native', 'Service.ets')])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
