#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export function verifyHarmonyReleaseActors({ allowlist, originalActor, triggeringActor }) {
  assert(
    typeof allowlist === 'string' &&
      allowlist.length > 0 &&
      !allowlist.startsWith(',') &&
      !allowlist.endsWith(',') &&
      !allowlist.includes(',,') &&
      !/\s/u.test(allowlist),
    'HARMONY_RELEASE_ALLOWED_ACTOR must be a comma-separated login list'
  )

  const allowedActors = new Set(allowlist.split(','))
  for (const [role, actor] of [
    ['original actor', originalActor],
    ['triggering actor', triggeringActor]
  ]) {
    assert(typeof actor === 'string' && actor.length > 0, `Harmony release ${role} is missing`)
    assert(allowedActors.has(actor), `Refusing Harmony release: ${role} ${actor} is not allowed`)
  }

  return { originalActor, triggeringActor }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const actors = verifyHarmonyReleaseActors({
    allowlist: process.env.HARMONY_RELEASE_ALLOWED_ACTOR ?? '',
    originalActor: process.env.HARMONY_RELEASE_ORIGINAL_ACTOR ?? '',
    triggeringActor: process.env.HARMONY_RELEASE_TRIGGERING_ACTOR ?? ''
  })
  console.log(
    `[release-actors] Verified original actor ${actors.originalActor} and ` +
      `triggering actor ${actors.triggeringActor}.`
  )
}
