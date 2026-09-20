import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { create, extract } from 'tar'
import { preparePatchedHarmonyHar } from './prepare-patched-harmony-har.mjs'
import { patchReactNativeCoreTextInput } from './react-native-core-text-input-patch.mjs'
import { textInputSourcePaths } from './test-fixtures/text-input-preedit-native.mjs'

const root = mkdtempSync(join(tmpdir(), 'orca-core-har-test-'))
const sourceRoot = join(root, 'upstream')
const packageRoot = join(root, 'node_modules/@react-native-oh/react-native-harmony')
const upstreamHar = fileURLToPath(
  new URL(
    '../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har',
    import.meta.url
  )
)
const generatedHar = join(root, 'generated/react_native_openharmony.har')
const options = {
  harmonyRoot: root,
  packageName: '@react-native-oh/react-native-harmony',
  expectedVersion: '0.84.3',
  moduleName: 'react_native_openharmony',
  harName: 'react_native_openharmony.har',
  harRelativePath: 'react_native_openharmony.har',
  logLabel: 'react-native-core',
  transformArchive: patchReactNativeCoreTextInput
}
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

before(async () => {
  mkdirSync(sourceRoot)
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '0.84.3' }))
  const paths = new Set(textInputSourcePaths.map((path) => `package/${path}`))
  await extract.asyncFile(
    { cwd: sourceRoot, file: upstreamHar, strict: true, filter: (path) => paths.has(path) },
    []
  )
  await create.asyncFile(
    { cwd: sourceRoot, file: join(packageRoot, options.harName), gzip: true },
    ['package']
  )
})
after(() => rmSync(root, { force: true, recursive: true }))

test('wires the generated core HAR into postinstall and both OHPM scopes', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(
    packageJson.scripts.postinstall,
    /patch-package.*prepare-react-native-core-har\.mjs.*prepare-harmony-profile/u
  )
  for (const path of ['../oh-package.json5', '../entry/oh-package.json5']) {
    const manifest = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(manifest, /generated\/react_native_openharmony\.har/u)
    assert.doesNotMatch(manifest, /node_modules.*react_native_openharmony\.har/u)
  }
})

test('repackages the root HAR deterministically and leaves the dependency untouched', async () => {
  const upstreamHash = hash(join(packageRoot, options.harName))
  await preparePatchedHarmonyHar(options)
  const firstHash = hash(generatedHar)
  await preparePatchedHarmonyHar(options)
  assert.equal(hash(generatedHar), firstHash)
  assert.equal(hash(join(packageRoot, options.harName)), upstreamHash)

  const packaged = join(root, 'packaged')
  mkdirSync(packaged)
  await extract.asyncFile({ cwd: packaged, file: generatedHar, strict: true }, [])
  patchReactNativeCoreTextInput(join(sourceRoot, 'package'))
  for (const path of textInputSourcePaths) {
    assert.equal(
      readFileSync(join(packaged, 'package', path), 'utf8'),
      readFileSync(join(sourceRoot, 'package', path), 'utf8')
    )
  }
})

test('rejects an unsupported version before replacing the last generated HAR', async () => {
  const previous = readFileSync(generatedHar)
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '0.85.0' }))
  await assert.rejects(
    preparePatchedHarmonyHar(options),
    /Unsupported react-native-core Harmony package/u
  )
  assert.deepEqual(readFileSync(generatedHar), previous)
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '0.84.3' }))
})

test('rejects source drift inside the pinned release before publishing', async () => {
  const previous = readFileSync(generatedHar)
  await assert.rejects(
    preparePatchedHarmonyHar({
      ...options,
      transformArchive: (archiveRoot) => {
        const path = join(archiveRoot, textInputSourcePaths[2])
        writeFileSync(path, readFileSync(path, 'utf8') + '\n// unexpected upstream edit\n')
        patchReactNativeCoreTextInput(archiveRoot)
      }
    }),
    /Unsupported RNOH 0\.84\.3 TextInput source/u
  )
  assert.deepEqual(readFileSync(generatedHar), previous)
})
