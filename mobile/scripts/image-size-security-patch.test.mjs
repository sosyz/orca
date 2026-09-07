import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const mobileRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pnpmStore = join(mobileRoot, 'node_modules', '.pnpm')
const imageSizeStoreEntries = readdirSync(pnpmStore).filter((entry) =>
  entry.startsWith('image-size@1.2.1_patch_hash=')
)

assert.equal(
  imageSizeStoreEntries.length,
  1,
  'expected exactly one patched image-size@1.2.1 package in the pnpm store'
)

const imageSizeRoot = join(pnpmStore, imageSizeStoreEntries[0], 'node_modules', 'image-size')
const imageSizePackage = JSON.parse(readFileSync(join(imageSizeRoot, 'package.json'), 'utf8'))
const imageSizeEntry = resolve(imageSizeRoot, imageSizePackage.main)

assert.equal(imageSizePackage.version, '1.2.1')
assert.match(imageSizeRoot, /image-size@1\.2\.1_patch_hash=/)
assert.match(
  readFileSync(join(imageSizeRoot, 'dist', 'types', 'icns.js'), 'utf8'),
  /imageHeader\[1\] > 0 \? imageHeader\[1\] : SIZE_HEADER/
)
assert.match(
  readFileSync(join(imageSizeRoot, 'dist', 'types', 'jxl.js'), 'utf8'),
  /jxlpBox\.size > 0 \? jxlpBox\.size : 8/
)

const runImageSize = (input) => {
  const childScript = `
    const imageSize = require(process.argv[1]);
    const input = Buffer.from(process.argv[2], 'base64');
    try {
      process.stdout.write(JSON.stringify({ ok: true, result: imageSize(input) }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
    }
  `

  return execFileSync(
    process.execPath,
    ['-e', childScript, imageSizeEntry, Buffer.from(input).toString('base64')],
    { encoding: 'utf8', timeout: 1000 }
  )
}

test('executes the installed patched package for zero-length ICNS entries', () => {
  const icns = Buffer.concat([
    Buffer.from('icns'),
    Buffer.from([0, 0, 0, 16]),
    Buffer.from('ic07'),
    Buffer.from([0, 0, 0, 0])
  ])

  const execution = JSON.parse(runImageSize(icns))

  assert.deepEqual(execution, {
    ok: true,
    result: { width: 128, height: 128, type: 'ic07' }
  })
})

test('executes the installed patched package for a zero-length JXLP box', () => {
  const jxl = Buffer.concat([
    Buffer.from([0, 0, 0, 12]),
    Buffer.from('JXL '),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 16]),
    Buffer.from('ftyp'),
    Buffer.from('jxl '),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('jxlp')
  ])

  const execution = JSON.parse(runImageSize(jxl))

  assert.equal(execution.ok, false)
  assert.equal(execution.error, 'Reached end of input')
})
