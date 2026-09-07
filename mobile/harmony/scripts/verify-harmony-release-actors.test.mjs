import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyHarmonyReleaseActors } from './verify-harmony-release-actors.mjs'

test('accepts authorized original and rerun actors', () => {
  assert.deepEqual(
    verifyHarmonyReleaseActors({
      allowlist: 'alice,bob',
      originalActor: 'alice',
      triggeringActor: 'bob'
    }),
    { originalActor: 'alice', triggeringActor: 'bob' }
  )
  assert.doesNotThrow(() =>
    verifyHarmonyReleaseActors({
      allowlist: 'github-actions[bot]',
      originalActor: 'github-actions[bot]',
      triggeringActor: 'github-actions[bot]'
    })
  )
})

test('rejects malformed or empty actor policies', () => {
  for (const allowlist of ['', ',alice', 'alice,', 'alice,,bob', 'alice, bob', 'alice\tbob']) {
    assert.throws(
      () =>
        verifyHarmonyReleaseActors({
          allowlist,
          originalActor: 'alice',
          triggeringActor: 'alice'
        }),
      /comma-separated login list/u
    )
  }
})

test('rejects missing or unauthorized original and rerun actors', () => {
  for (const actors of [
    { originalActor: '', triggeringActor: 'alice' },
    { originalActor: 'alice', triggeringActor: '' },
    { originalActor: 'mallory', triggeringActor: 'alice' },
    { originalActor: 'alice', triggeringActor: 'mallory' }
  ]) {
    assert.throws(() => verifyHarmonyReleaseActors({ allowlist: 'alice,bob', ...actors }))
  }
})

test('treats actor policy tokens literally instead of as wildcard patterns', () => {
  assert.throws(
    () =>
      verifyHarmonyReleaseActors({
        allowlist: '*',
        originalActor: 'mallory',
        triggeringActor: 'mallory'
      }),
    /not allowed/u
  )
})
