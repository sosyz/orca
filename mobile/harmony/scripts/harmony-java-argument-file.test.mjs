import assert from 'node:assert/strict'
import test from 'node:test'
import { formatJavaArgumentFile } from './harmony-java-argument-file.mjs'

test('quotes spaces, backslashes, and double quotes without exposing separate tokens', () => {
  assert.equal(
    formatJavaArgumentFile(['-jar', '/Applications/DevEco Studio/tool.jar', 'a\\b"c']),
    '"-jar"\n"/Applications/DevEco Studio/tool.jar"\n"a\\\\b\\"c"\n'
  )
})

test('rejects newline injection', () => {
  assert.throws(() => formatJavaArgumentFile(['safe\n-evil']), /must not contain newlines/u)
})
