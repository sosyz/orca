import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { extract } from 'tar'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const postinstall = packageJson.scripts.postinstall
const sourceRoot = new URL(
  '../node_modules/@react-native-oh-tpl/react-native-safe-area-context/harmony/safe_area/src/main/ets/',
  import.meta.url
)
const harPath = fileURLToPath(new URL('../generated/safe_area.har', import.meta.url))
const prepareScript = fileURLToPath(
  new URL('./prepare-react-native-safe-area-har.mjs', import.meta.url)
)

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

test('prepares the safe-area HAR after patch-package and before profile setup', () => {
  const patchIndex = postinstall.indexOf('patch-package')
  const harIndex = postinstall.indexOf('prepare-react-native-safe-area-har.mjs')
  const profileIndex = postinstall.indexOf('prepare-harmony-profile.mjs')
  assert.ok(patchIndex !== -1 && patchIndex < harIndex && harIndex < profileIndex)
})

test('keeps OHPM on the patched safe-area HAR', () => {
  const ohPackage = readFileSync(new URL('../oh-package.json5', import.meta.url), 'utf8')
  assert.match(ohPackage, /'file:\.\/generated\/safe_area\.har'/u)
  assert.doesNotMatch(ohPackage, /react-native-safe-area-context\/harmony\/safe_area\.har/u)
})

test('packages responsive safe-area sources', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'orca-safe-area-har-test-'))
  try {
    await extract.asyncFile({ cwd: temporaryRoot, file: harPath, strict: true }, [])
    for (const fileName of ['SafeAreaProvider.ets', 'SafeViewTurboModule.ts']) {
      const packaged = readFileSync(
        join(temporaryRoot, 'package', 'src', 'main', 'ets', fileName),
        'utf8'
      )
      assert.equal(packaged, readFileSync(new URL(fileName, sourceRoot), 'utf8'))
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
})

test('rebuilds safe-area HAR deterministically without modifying the dependency HAR', () => {
  const dependencyHarPath = fileURLToPath(
    new URL(
      '../node_modules/@react-native-oh-tpl/react-native-safe-area-context/harmony/safe_area.har',
      import.meta.url
    )
  )
  const dependencyHash = fileSha256(dependencyHarPath)
  execFileSync(process.execPath, [prepareScript])
  const firstGeneratedHash = fileSha256(harPath)
  execFileSync(process.execPath, [prepareScript])

  assert.equal(fileSha256(harPath), firstGeneratedHash)
  assert.equal(fileSha256(dependencyHarPath), dependencyHash)
})

test('patches side inset dimensions and refreshes metrics after rotation', () => {
  const turboModule = readFileSync(new URL('SafeViewTurboModule.ts', sourceRoot), 'utf8')
  const provider = readFileSync(new URL('SafeAreaProvider.ets', sourceRoot), 'utf8')

  assert.match(turboModule, /AvoidAreaType\.TYPE_CUTOUT/u)
  assert.match(turboModule, /system\.rightRect\.width/u)
  assert.match(turboModule, /cutout\.rightRect\.width/u)
  assert.match(turboModule, /system\.leftRect\.width/u)
  assert.match(turboModule, /cutout\.leftRect\.width/u)
  assert.doesNotMatch(turboModule, /(rightRect|leftRect)\.height/u)
  assert.match(provider, /\.on\('windowSizeChange'/u)
  assert.match(provider, /\.on\('avoidAreaChange'/u)
  assert.match(provider, /\.off\('windowSizeChange'/u)
  assert.match(provider, /\.off\('avoidAreaChange'/u)
  assert.match(provider, /frame: data\.frame/u)
})

test('keeps the safe-area patch textual and limited to expected ArkTS files', () => {
  const patch = readFileSync(
    new URL(
      '../patches/@react-native-oh-tpl+react-native-safe-area-context+4.7.4-0.2.1.patch',
      import.meta.url
    ),
    'utf8'
  )
  assert.doesNotMatch(patch, /Binary files|\.har\b|\boh_modules\b|\.hvigor/u)
  const changedFiles = Array.from(
    patch.matchAll(/^diff --git a\/(.+?) b\//gmu),
    (match) => match[1]
  )
  assert.deepEqual(changedFiles, [
    'node_modules/@react-native-oh-tpl/react-native-safe-area-context/harmony/safe_area/src/main/ets/SafeAreaProvider.ets',
    'node_modules/@react-native-oh-tpl/react-native-safe-area-context/harmony/safe_area/src/main/ets/SafeViewTurboModule.ts'
  ])
})
