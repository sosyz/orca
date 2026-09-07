#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openHarmonyHapArchive } from './harmony-hap-archive.mjs'

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function compareHarmonyHapContents(referencePath, candidatePath) {
  const reference = openHarmonyHapArchive(referencePath)
  const candidate = openHarmonyHapArchive(candidatePath)
  const referenceNames = reference.entryNames.toSorted()
  const candidateNames = candidate.entryNames.toSorted()

  if (referenceNames.length !== candidateNames.length) {
    throw new Error('Rebuilt HAP entry set does not match the reference HAP')
  }

  const contentDigest = createHash('sha256')
  for (let index = 0; index < referenceNames.length; index += 1) {
    const name = referenceNames[index]
    if (name !== candidateNames[index]) {
      throw new Error('Rebuilt HAP entry set does not match the reference HAP')
    }
    const referenceContent = reference.readEntry(name)
    const candidateContent = candidate.readEntry(name)
    const referenceDigest = sha256(referenceContent)
    if (
      referenceContent.length !== candidateContent.length ||
      referenceDigest !== sha256(candidateContent)
    ) {
      throw new Error(`Rebuilt HAP content does not match for entry: ${name}`)
    }
    contentDigest.update(`${name}\0${referenceContent.length}\0${referenceDigest}\0`)
  }

  return {
    contentSha256: contentDigest.digest('hex'),
    entryCount: referenceNames.length
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const [referencePath, candidatePath] = process.argv.slice(2)
  if (!referencePath || !candidatePath || process.argv.length !== 4) {
    throw new Error('Usage: compare-harmony-hap-contents.mjs <reference.hap> <rebuilt.hap>')
  }
  const result = compareHarmonyHapContents(resolve(referencePath), resolve(candidatePath))
  console.log(`[reproducible-hap] Verified ${result.entryCount} entries (${result.contentSha256}).`)
}
