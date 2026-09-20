import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createStoredHap } from './harmony-hap-test-archive.mjs'
import { verifyHarmonyReleaseHap } from './verify-harmony-hap.mjs'

const expectedVersion = { versionCode: 47, versionName: '0.0.47' }
const mesloWoff2Path = join(
  import.meta.dirname,
  '..',
  '..',
  'assets',
  'fonts',
  'MesloLGS-NF-Regular.woff2'
)
const mesloWoff2 = readFileSync(mesloWoff2Path)
const notoEmojiWoff2Path = join(
  import.meta.dirname,
  '..',
  '..',
  'assets',
  'fonts',
  'Noto-COLRv1.woff2'
)
const notoEmojiWoff2 = readFileSync(notoEmojiWoff2Path)
const notoColorEmojiPath = join(
  import.meta.dirname,
  '..',
  'entry',
  'src',
  'main',
  'resources',
  'rawfile',
  'fonts',
  'Noto-COLRv1.ttf'
)
const notoColorEmoji = readFileSync(notoColorEmojiPath)
const hermesBundleWithTerminalFonts = Buffer.concat([
  Buffer.from('c61fbc03c103191f00', 'hex'),
  Buffer.from(mesloWoff2.toString('base64')),
  Buffer.from(notoEmojiWoff2.toString('base64'))
])
const verifyOptions = {
  expectedVersion,
  mesloWoff2Path,
  notoEmojiWoff2Path,
  verifySourceResources: false
}

function releaseManifest() {
  return {
    app: {
      buildMode: 'release',
      bundleName: 'ai.stably.orca.harmony',
      bundleType: 'app',
      debug: false,
      versionCode: 47,
      versionName: '0.0.47'
    },
    module: {
      abilities: [
        {
          skills: [
            {
              actions: ['ohos.want.action.viewData'],
              uris: [{ host: 'pair', scheme: 'orca' }]
            }
          ]
        }
      ],
      compileMode: 'esmodule',
      deviceTypes: ['phone', 'tablet', '2in1'],
      requestPermissions: [
        { name: 'ohos.permission.INTERNET' },
        { name: 'ohos.permission.VIBRATE' },
        { name: 'ohos.permission.GET_NETWORK_INFO' },
        { name: 'ohos.permission.READ_PASTEBOARD' },
        { name: 'ohos.permission.MICROPHONE' }
      ],
      type: 'entry'
    }
  }
}

function requiredEntries(overrides = {}) {
  return {
    'libs/arm64-v8a/librnoh_app.so': Buffer.from('7f454c4600', 'hex'),
    'module.json': JSON.stringify(releaseManifest()),
    'resources/rawfile/fonts/Apache-2.0.txt': 'license'.repeat(30),
    'resources/rawfile/fonts/MesloLGS-NF-License.txt': 'license'.repeat(30),
    'resources/rawfile/fonts/MesloLGS-NF-Regular.ttf': Buffer.from('0001000000', 'hex'),
    'resources/rawfile/fonts/Noto-COLRv1.ttf': notoColorEmoji,
    'resources/rawfile/fonts/NotoEmoji-OFL-1.1.txt': 'license'.repeat(30),
    'resources/rawfile/fonts/SymbolsNerdFontMono-OFL.txt': 'license'.repeat(30),
    'resources/rawfile/hermes_bundle.hbc': hermesBundleWithTerminalFonts,
    ...overrides
  }
}

function withHap(entries, callback, transform = (archive) => archive) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-hap-test-'))
  const path = join(directory, 'entry.hap')
  try {
    writeFileSync(path, transform(createStoredHap(entries)))
    callback(path)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

function withSourceResources(entries, callback) {
  const harmonyRoot = mkdtempSync(join(tmpdir(), 'orca-hap-source-test-'))
  try {
    for (const [name, value] of Object.entries(entries)) {
      if (!name.startsWith('resources/')) {
        continue
      }
      const path = join(harmonyRoot, 'entry/src/main', name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, value)
    }
    callback(harmonyRoot)
  } finally {
    rmSync(harmonyRoot, { force: true, recursive: true })
  }
}

function insertHarmonySigningBlock(archive, mutate = () => {}) {
  const endOffset = archive.length - 22
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  const value = Buffer.from('signed-profile')
  const descriptor = Buffer.alloc(12)
  descriptor.writeUInt32LE(0x20000002, 0)
  descriptor.writeUInt32LE(value.length, 4)
  descriptor.writeUInt32LE(descriptor.length, 8)
  const footer = Buffer.alloc(32)
  footer.writeUInt32LE(1, 0)
  footer.writeBigUInt64LE(BigInt(descriptor.length + value.length + footer.length), 4)
  footer.write('<hap sign block>', 12)
  footer.writeUInt32LE(3, 28)
  const signingBlock = Buffer.concat([descriptor, value, footer])
  mutate(signingBlock)
  const result = Buffer.concat([
    archive.subarray(0, centralOffset),
    signingBlock,
    archive.subarray(centralOffset)
  ])
  result.writeUInt32LE(centralOffset + signingBlock.length, endOffset + signingBlock.length + 16)
  return result
}

test('accepts a release HAP with HBC and required capabilities', () => {
  withHap(requiredEntries(), (path) => {
    const result = verifyHarmonyReleaseHap(path, verifyOptions)
    assert.equal(result.bundleName, 'ai.stably.orca.harmony')
    assert.equal(result.versionCode, 47)
  })
})

test('rejects tampered payloads and local-header disagreement', () => {
  const firstEntryNameBytes = Buffer.byteLength('libs/arm64-v8a/librnoh_app.so')
  withHap(
    requiredEntries(),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /checksum mismatch/u)
    },
    (archive) => {
      archive[30 + firstEntryNameBytes] ^= 1
      return archive
    }
  )
  withHap(
    requiredEntries(),
    (path) => {
      assert.throws(
        () => verifyHarmonyReleaseHap(path, verifyOptions),
        /local header does not match/u
      )
    },
    (archive) => {
      archive.writeUInt16LE(8, 8)
      return archive
    }
  )
})

test('rejects trailing, prefixed, and uncovered archive bytes', () => {
  const cases = [
    (archive) => Buffer.concat([archive, Buffer.from('trailing')]),
    (archive) => Buffer.concat([Buffer.from('prefix'), archive]),
    (archive) => {
      const endOffset = archive.length - 22
      const centralOffset = archive.readUInt32LE(endOffset + 16)
      const gap = Buffer.from('gap')
      const result = Buffer.concat([
        archive.subarray(0, centralOffset),
        gap,
        archive.subarray(centralOffset)
      ])
      result.writeUInt32LE(centralOffset + gap.length, endOffset + gap.length + 16)
      return result
    }
  ]
  for (const transform of cases) {
    withHap(
      requiredEntries(),
      (path) => {
        assert.throws(
          () => verifyHarmonyReleaseHap(path, verifyOptions),
          /valid ZIP|central directory|signing block|local header/u
        )
      },
      transform
    )
  }
})

test('accepts a structured Harmony signing block and rejects malformed descriptors', () => {
  withHap(
    requiredEntries(),
    (path) => {
      assert.equal(
        verifyHarmonyReleaseHap(path, verifyOptions).bundleName,
        'ai.stably.orca.harmony'
      )
    },
    (archive) => insertHarmonySigningBlock(archive)
  )
  withHap(
    requiredEntries(),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /signing block/u)
    },
    (archive) =>
      insertHarmonySigningBlock(archive, (signingBlock) => {
        signingBlock.writeUInt32LE(0, 8)
      })
  )
})

test('rejects plaintext JavaScript in the final HAP', () => {
  withHap(requiredEntries({ 'resources/rawfile/bundle.harmony.js': 'alert(1)' }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /plaintext JavaScript/u)
  })
})

test('rejects duplicate rawfile terminal WOFF2 fonts', () => {
  const cases = [
    ['resources/rawfile/fonts/MesloLGS-NF-Regular.woff2', mesloWoff2],
    ['resources/rawfile/fonts/Noto-COLRv1.woff2', notoEmojiWoff2]
  ]
  for (const [name, value] of cases) {
    withHap(requiredEntries({ [name]: value }), (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /duplicate terminal/u)
    })
  }
})

test('rejects a debug HAP even when its payload is otherwise valid', () => {
  const manifest = releaseManifest()
  manifest.app.debug = true
  manifest.app.buildMode = 'debug'
  withHap(requiredEntries({ 'module.json': JSON.stringify(manifest) }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /not a release/u)
  })
})

test('rejects missing 2in1 support and required vibration access', () => {
  const manifest = releaseManifest()
  manifest.module.deviceTypes = ['phone', 'tablet']
  manifest.module.requestPermissions = manifest.module.requestPermissions.filter(
    ({ name }) => name !== 'ohos.permission.VIBRATE'
  )
  withHap(requiredEntries({ 'module.json': JSON.stringify(manifest) }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /support 2in1/u)
  })

  manifest.module.deviceTypes.push('2in1')
  withHap(requiredEntries({ 'module.json': JSON.stringify(manifest) }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /VIBRATE/u)
  })
})

test('rejects undeclared permission expansion', () => {
  const manifest = releaseManifest()
  manifest.module.requestPermissions.push({ name: 'ohos.permission.CAMERA' })
  withHap(requiredEntries({ 'module.json': JSON.stringify(manifest) }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /unexpected permissions/u)
  })
})

test('rejects non-ARM libraries, PGO data, signing material, and local build paths', () => {
  const cases = [
    ['libs/x86_64/libc++_shared.so', Buffer.from('7f454c4600', 'hex')],
    ['resources/rawfile/rnoh.profdata', 'profile'],
    ['resources/rawfile/release.pfx', 'secret'],
    [
      'libs/arm64-v8a/librnoh_app.so',
      Buffer.from(`\x7fELF${['', 'Users', 'developer', 'orca'].join('/')}`)
    ]
  ]
  for (const [name, value] of cases) {
    withHap(requiredEntries({ [name]: value }), (path) => {
      assert.throws(
        () => verifyHarmonyReleaseHap(path, verifyOptions),
        /unsupported native ABI|forbidden build or signing material|local build path/u
      )
    })
  }
})

test('rejects HBC without the embedded build-time terminal font', () => {
  withHap(
    requiredEntries({
      'resources/rawfile/hermes_bundle.hbc': Buffer.from('c61fbc03c103191f00', 'hex')
    }),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /terminal WebView font/u)
    }
  )
})

test('rejects HBC without the embedded terminal emoji font', () => {
  withHap(
    requiredEntries({
      'resources/rawfile/hermes_bundle.hbc': Buffer.concat([
        Buffer.from('c61fbc03c103191f00', 'hex'),
        Buffer.from(mesloWoff2.toString('base64'))
      ])
    }),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /terminal WebView emoji/u)
    }
  )
})

test('rejects malformed packaged native font and native binaries', () => {
  withHap(
    requiredEntries({
      'resources/rawfile/fonts/MesloLGS-NF-Regular.ttf': 'not-a-font'
    }),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /not TTF/u)
    }
  )
  withHap(
    requiredEntries({
      'resources/rawfile/fonts/Noto-COLRv1.ttf': 'not-a-font'
    }),
    (path) => {
      assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /not TTF/u)
    }
  )
  withHap(requiredEntries({ 'libs/arm64-v8a/librnoh_app.so': 'not-elf' }), (path) => {
    assert.throws(() => verifyHarmonyReleaseHap(path, verifyOptions), /not ELF/u)
  })
})

test('rejects resources that do not match the release source tree', () => {
  const entries = requiredEntries()
  withSourceResources(entries, (harmonyRoot) => {
    entries['resources/rawfile/hermes_bundle.hbc'] = Buffer.concat([
      hermesBundleWithTerminalFonts,
      Buffer.from([1])
    ])
    withHap(entries, (path) => {
      assert.throws(
        () =>
          verifyHarmonyReleaseHap(path, {
            expectedVersion,
            harmonyRoot,
            mesloWoff2Path,
            notoEmojiWoff2Path
          }),
        /contains stale resources\/rawfile\/hermes_bundle\.hbc/u
      )
    })
  })
})
