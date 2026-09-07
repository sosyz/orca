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
  '../node_modules/@react-native-oh-tpl/react-native-webview/harmony/rn_webview/src/main/ets/',
  import.meta.url
)
const harPath = fileURLToPath(new URL('../generated/rn_webview.har', import.meta.url))
const prepareScript = fileURLToPath(
  new URL('./prepare-react-native-webview-har.mjs', import.meta.url)
)

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

test('prepares the patched HAR after patch-package and before profile setup', () => {
  const patchIndex = postinstall.indexOf('patch-package')
  const harIndex = postinstall.indexOf('prepare-react-native-webview-har.mjs')
  const profileIndex = postinstall.indexOf('prepare-harmony-profile.mjs')
  assert.ok(patchIndex !== -1 && patchIndex < harIndex && harIndex < profileIndex)
})

test('keeps OHPM on the patched HAR instead of a source dependency', () => {
  const ohPackage = readFileSync(new URL('../oh-package.json5', import.meta.url), 'utf8')
  assert.match(ohPackage, /'file:\.\/generated\/rn_webview\.har'/u)
  assert.doesNotMatch(ohPackage, /react-native-webview\/harmony\/rn_webview\.har/u)
})

test('packages the patched native WebView sources', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'orca-webview-har-test-'))
  try {
    await extract.asyncFile({ cwd: temporaryRoot, file: harPath, strict: true }, [])
    for (const fileName of ['Magic.ets', 'RNCWebView.ets', 'WebViewBaseOperate.ets']) {
      const packaged = readFileSync(
        join(temporaryRoot, 'package', 'src', 'main', 'ets', fileName),
        'utf8'
      )
      const patched = readFileSync(new URL(fileName, sourceRoot), 'utf8')
      assert.equal(packaged, patched)
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
})

test('rebuilds the patched HAR deterministically without modifying the dependency HAR', () => {
  const dependencyHarPath = fileURLToPath(
    new URL(
      '../node_modules/@react-native-oh-tpl/react-native-webview/harmony/rn_webview.har',
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

test('keeps the source patch textual and limited to expected ArkTS files', () => {
  const patch = readFileSync(
    new URL('../patches/@react-native-oh-tpl+react-native-webview+13.10.3.patch', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(patch, /Binary files|\.har\b|\boh_modules\b|\.hvigor/u)
  const changedFiles = Array.from(
    patch.matchAll(/^diff --git a\/(.+?) b\//gmu),
    (match) => match[1]
  )
  assert.deepEqual(changedFiles, [
    'node_modules/@react-native-oh-tpl/react-native-webview/harmony/rn_webview/src/main/ets/Magic.ets',
    'node_modules/@react-native-oh-tpl/react-native-webview/harmony/rn_webview/src/main/ets/RNCWebView.ets',
    'node_modules/@react-native-oh-tpl/react-native-webview/harmony/rn_webview/src/main/ets/WebViewBaseOperate.ets'
  ])
})
