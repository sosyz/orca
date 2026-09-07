import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const harmonyRoot = resolve(import.meta.dirname, '..')
const rawfileRoot = resolve(harmonyRoot, 'entry/src/main/resources/rawfile')
const hbcPath = resolve(rawfileRoot, 'hermes_bundle.hbc')
const legacyJsPath = resolve(rawfileRoot, 'bundle.harmony.js')
const command = process.argv[2]

if (command === 'clean') {
  rmSync(hbcPath, { force: true })
  rmSync(legacyJsPath, { force: true })
} else if (command === 'verify') {
  const byteLength = statSync(hbcPath).size
  if (byteLength === 0) {
    throw new Error('Hermes bytecode bundle is empty')
  }
  const magic = readFileSync(hbcPath).subarray(0, 8).toString('hex')
  if (magic !== 'c61fbc03c103191f') {
    throw new Error('Harmony release bundle is not Hermes bytecode')
  }
  if (existsSync(legacyJsPath)) {
    throw new Error('Legacy plaintext Harmony bundle must not be packaged')
  }
} else {
  throw new Error('Usage: harmony-release-bundle-artifact.mjs <clean|verify>')
}
