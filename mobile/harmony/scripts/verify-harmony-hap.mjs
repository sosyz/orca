import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openHarmonyHapArchive } from './harmony-hap-archive.mjs'

const EXPECTED_BUNDLE_NAME = 'ai.stably.orca.harmony'
const HERMES_MAGIC = 'c61fbc03c103191f'
const ELF_MAGIC = '7f454c46'
const TTF_MAGIC = '00010000'
const WOFF2_MAGIC = '774f4632'
const MESLO_WOFF2_SOURCE_PATH = ['assets', 'fonts', 'MesloLGS-NF-Regular.woff2']
const NOTO_COLRV1_WOFF2_SOURCE_PATH = ['assets', 'fonts', 'Noto-COLRv1.woff2']
const DUPLICATE_TERMINAL_WOFF2_ENTRY = 'resources/rawfile/fonts/MesloLGS-NF-Regular.woff2'
const DUPLICATE_EMOJI_WOFF2_ENTRY = 'resources/rawfile/fonts/Noto-COLRv1.woff2'
const REQUIRED_ENTRIES = [
  'resources/rawfile/hermes_bundle.hbc',
  'resources/rawfile/fonts/MesloLGS-NF-Regular.ttf',
  'resources/rawfile/fonts/Noto-COLRv1.ttf',
  'resources/rawfile/fonts/MesloLGS-NF-License.txt',
  'resources/rawfile/fonts/NotoEmoji-OFL-1.1.txt',
  'resources/rawfile/fonts/Apache-2.0.txt',
  'resources/rawfile/fonts/SymbolsNerdFontMono-OFL.txt',
  'libs/arm64-v8a/librnoh_app.so'
]
const REQUIRED_PERMISSIONS = [
  'ohos.permission.INTERNET',
  'ohos.permission.VIBRATE',
  'ohos.permission.GET_NETWORK_INFO',
  'ohos.permission.READ_PASTEBOARD',
  'ohos.permission.MICROPHONE'
]
const REQUIRED_PERMISSION_SET = new Set(REQUIRED_PERMISSIONS)
const FORBIDDEN_ENTRY_PATTERN =
  /(?:^|\/)(?:rnoh\.profdata|[^/]+\.(?:cer|crt|csr|der|jks|key|keystore|p10|p12|p7b|p7c|p8|pem|pfx|pk8|pkcs8|pvk|spc))$/iu
const LOCAL_BUILD_PATH_MARKERS = [['', 'Users', ''].join('/'), ['', 'home', ''].join('/')]
const WINDOWS_LOCAL_BUILD_PATH_PATTERN = new RegExp('[A-Za-z]:\\\\' + 'Users' + '\\\\', 'u')
const SOURCE_RESOURCE_ENTRIES = REQUIRED_ENTRIES.filter((entry) => entry.startsWith('resources/'))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function parseJson(content, name) {
  try {
    return JSON.parse(content.toString('utf8'))
  } catch {
    throw new Error(`HAP contains invalid ${name}`)
  }
}

function hasPairDeepLink(module) {
  return module.abilities?.some((ability) =>
    ability.skills?.some(
      (skill) =>
        skill.actions?.includes('ohos.want.action.viewData') &&
        skill.uris?.some((uri) => uri.scheme === 'orca' && uri.host === 'pair')
    )
  )
}

function loadExpectedVersion(harmonyRoot) {
  const appConfig = JSON.parse(readFileSync(join(harmonyRoot, 'AppScope/app.json5'), 'utf8')).app
  return {
    versionCode: appConfig.versionCode,
    versionName: appConfig.versionName
  }
}

function assertPackagedResourcesMatchSource(archive, harmonyRoot) {
  for (const entry of SOURCE_RESOURCE_ENTRIES) {
    const packaged = archive.readEntry(entry)
    const source = readFileSync(join(harmonyRoot, 'entry/src/main', entry))
    assert(packaged.equals(source), `Release HAP contains stale ${entry}`)
  }
}

function assertEmbeddedTerminalFontMatchesSource(archive, harmonyRoot, options) {
  const fontPath = options.mesloWoff2Path ?? join(harmonyRoot, '..', ...MESLO_WOFF2_SOURCE_PATH)
  const terminalFont = readFileSync(fontPath)
  assert(
    terminalFont.subarray(0, 4).toString('hex') === WOFF2_MAGIC,
    'Build-time terminal font is not WOFF2'
  )
  const embeddedFont = Buffer.from(terminalFont.toString('base64'))
  const hbc = archive.readEntry('resources/rawfile/hermes_bundle.hbc')
  assert(
    hbc.includes(embeddedFont),
    'Release HAP terminal WebView font does not match the build-time Meslo WOFF2'
  )
}

function assertEmbeddedTerminalEmojiFontMatchesSource(archive, harmonyRoot, options) {
  const fontPath =
    options.notoEmojiWoff2Path ?? join(harmonyRoot, '..', ...NOTO_COLRV1_WOFF2_SOURCE_PATH)
  const terminalEmojiFont = readFileSync(fontPath)
  assert(
    terminalEmojiFont.subarray(0, 4).toString('hex') === WOFF2_MAGIC,
    'Build-time terminal emoji font is not WOFF2'
  )
  const embeddedFont = Buffer.from(terminalEmojiFont.toString('base64'))
  const hbc = archive.readEntry('resources/rawfile/hermes_bundle.hbc')
  assert(
    hbc.includes(embeddedFont),
    'Release HAP terminal WebView emoji font does not match the build-time Noto COLRv1 WOFF2'
  )
}

export function verifyHarmonyReleaseHap(hapPath, options = {}) {
  const resolvedPath = resolve(hapPath)
  const harmonyRoot = options.harmonyRoot ?? resolve(import.meta.dirname, '..')
  const archive = openHarmonyHapArchive(resolvedPath)
  const entrySet = new Set(archive.entryNames)
  const manifest = parseJson(archive.readEntry('module.json'), 'module.json')
  const app = manifest.app ?? {}
  const module = manifest.module ?? {}
  const expectedVersion = options.expectedVersion ?? loadExpectedVersion(harmonyRoot)

  assert(app.bundleName === EXPECTED_BUNDLE_NAME, 'Release HAP has the wrong bundle name')
  assert(app.buildMode === 'release' && app.debug === false, 'HAP is not a release build')
  assert(app.bundleType === 'app', 'Release HAP has the wrong bundle type')
  assert(app.versionName === expectedVersion.versionName, 'Release HAP versionName is stale')
  assert(app.versionCode === expectedVersion.versionCode, 'Release HAP versionCode is stale')
  assert(
    module.type === 'entry' && module.compileMode === 'esmodule',
    'HAP entry module is invalid'
  )

  const deviceTypes = new Set(module.deviceTypes ?? [])
  for (const deviceType of ['phone', 'tablet', '2in1']) {
    assert(deviceTypes.has(deviceType), `Release HAP does not support ${deviceType}`)
  }
  const requestedPermissions = (module.requestPermissions ?? []).map(
    (permission) => permission.name
  )
  const permissionNames = new Set(requestedPermissions)
  for (const permission of REQUIRED_PERMISSIONS) {
    assert(permissionNames.has(permission), `Release HAP is missing ${permission}`)
  }
  const unexpectedPermissions = requestedPermissions.filter(
    (permission) => !REQUIRED_PERMISSION_SET.has(permission)
  )
  assert(
    unexpectedPermissions.length === 0,
    `Release HAP requests unexpected permissions: ${unexpectedPermissions.join(', ')}`
  )
  assert(
    permissionNames.size === requestedPermissions.length,
    'Release HAP contains duplicate permission declarations'
  )
  assert(hasPairDeepLink(module), 'Release HAP is missing the orca://pair deep link')

  for (const entry of REQUIRED_ENTRIES) {
    assert(entrySet.has(entry), `Release HAP is missing ${entry}`)
  }
  assert(
    !entrySet.has(DUPLICATE_TERMINAL_WOFF2_ENTRY),
    'Release HAP still packages duplicate terminal WOFF2 rawfile'
  )
  assert(
    !entrySet.has(DUPLICATE_EMOJI_WOFF2_ENTRY),
    'Release HAP still packages duplicate terminal emoji WOFF2 rawfile'
  )
  const plaintextEntries = archive.entryNames.filter((name) =>
    /(?:^|\/)(?:bundle\.harmony\.js|[^/]+\.js(?:\.map)?|[^/]+\.map)$/iu.test(name)
  )
  assert(plaintextEntries.length === 0, 'Release HAP contains plaintext JavaScript or source maps')
  const forbiddenEntry = archive.entryNames.find((name) => FORBIDDEN_ENTRY_PATTERN.test(name))
  assert(
    !forbiddenEntry,
    `Release HAP contains forbidden build or signing material: ${forbiddenEntry}`
  )

  for (const entry of archive.entryNames) {
    const nativeLibraryMatch = /^libs\/([^/]+)\/[^/]+\.so$/u.exec(entry)
    if (!nativeLibraryMatch) {
      continue
    }
    assert(
      nativeLibraryMatch[1] === 'arm64-v8a',
      `Release HAP contains an unsupported native ABI: ${entry}`
    )
    const nativeLibraryBytes = archive.readEntry(entry)
    const localPath = LOCAL_BUILD_PATH_MARKERS.find((marker) =>
      nativeLibraryBytes.includes(Buffer.from(marker))
    )
    assert(!localPath, `Release HAP native library exposes a local build path: ${entry}`)
    assert(
      !WINDOWS_LOCAL_BUILD_PATH_PATTERN.test(nativeLibraryBytes.toString('latin1')),
      `Release HAP native library exposes a local Windows build path: ${entry}`
    )
  }

  const hbc = archive.readEntry('resources/rawfile/hermes_bundle.hbc')
  assert(hbc.length > 8, 'Release HAP contains empty Hermes bytecode')
  assert(hbc.subarray(0, 8).toString('hex') === HERMES_MAGIC, 'Release HAP bundle is not HBC')
  assertEmbeddedTerminalFontMatchesSource(archive, harmonyRoot, options)
  assertEmbeddedTerminalEmojiFontMatchesSource(archive, harmonyRoot, options)
  const nativeFont = archive.readEntry('resources/rawfile/fonts/MesloLGS-NF-Regular.ttf')
  assert(
    nativeFont.subarray(0, 4).toString('hex') === TTF_MAGIC,
    'Release HAP native monospace font is not TTF'
  )
  const nativeEmojiFont = archive.readEntry('resources/rawfile/fonts/Noto-COLRv1.ttf')
  assert(
    nativeEmojiFont.subarray(0, 4).toString('hex') === TTF_MAGIC,
    'Release HAP native emoji font is not TTF'
  )
  const nativeLibrary = archive.readEntry('libs/arm64-v8a/librnoh_app.so')
  assert(
    nativeLibrary.subarray(0, 4).toString('hex') === ELF_MAGIC,
    'Release HAP ARM64 library is not ELF'
  )
  for (const licenseEntry of [
    'resources/rawfile/fonts/MesloLGS-NF-License.txt',
    'resources/rawfile/fonts/Apache-2.0.txt',
    'resources/rawfile/fonts/NotoEmoji-OFL-1.1.txt',
    'resources/rawfile/fonts/SymbolsNerdFontMono-OFL.txt'
  ]) {
    assert(
      archive.readEntry(licenseEntry).length > 100,
      `Release HAP contains empty ${licenseEntry}`
    )
  }
  if (options.verifySourceResources !== false) {
    assertPackagedResourcesMatchSource(archive, harmonyRoot)
  }

  const bytes = readFileSync(resolvedPath)
  return {
    bundleName: app.bundleName,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    versionCode: app.versionCode,
    versionName: app.versionName
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const hapPath = process.argv[2]
  if (!hapPath) {
    throw new Error('Usage: verify-harmony-hap.mjs <release.hap>')
  }
  const evidence = verifyHarmonyReleaseHap(hapPath)
  console.log(
    `[release-hap] Verified ${evidence.bundleName} ${evidence.versionName} (${evidence.versionCode}), sha256=${evidence.sha256}`
  )
}
