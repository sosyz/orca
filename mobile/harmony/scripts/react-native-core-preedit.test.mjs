import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { extract } from 'tar'
import {
  runNativeTextInputCase,
  textInputSourcePaths
} from './test-fixtures/text-input-preedit-native.mjs'

const scenarios = JSON.parse(
  readFileSync(new URL('./test-fixtures/text-input-preedit-cases.json', import.meta.url), 'utf8')
)
const temporaryRoot = mkdtempSync(join(tmpdir(), 'orca-text-input-har-'))
const harPath =
  process.env.ORCA_TEST_CORE_HAR ||
  fileURLToPath(new URL('../generated/react_native_openharmony.har', import.meta.url))

before(async () => {
  const paths = new Set(textInputSourcePaths.map((path) => `package/${path}`))
  await extract.asyncFile(
    { cwd: temporaryRoot, file: harPath, strict: true, filter: (path) => paths.has(path) },
    []
  )
})
after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

for (const multiline of [false, true]) {
  for (const scenario of scenarios) {
    test(`${multiline ? 'TextArea' : 'TextInput'}: ${scenario.name}`, () => {
      const result = runNativeTextInputCase(join(temporaryRoot, 'package'), scenario, multiline)
      assert.deepEqual(result.events, scenario.events)
      assert.deepEqual(
        result.commandSelections,
        scenario.steps
          .filter((step) => 'command' in step)
          .map((step) => [step.selection[0], step.selection[1] - step.selection[0]])
      )
    })
  }
}
