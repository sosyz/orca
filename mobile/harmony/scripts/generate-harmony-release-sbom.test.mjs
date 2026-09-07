import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  deterministicHarmonyReleaseSbom,
  mergeHarmonyOhpmDependencies,
  validateHarmonyReleaseSbom
} from './generate-harmony-release-sbom.mjs'

function sbomWithComponents(components) {
  const rootRef = 'orca@1.0.0'
  return {
    bomFormat: 'CycloneDX',
    components,
    dependencies: [
      { ref: rootRef, dependsOn: components.map((component) => component['bom-ref']) },
      ...components.map((component) => ({ ref: component['bom-ref'], dependsOn: [] }))
    ],
    metadata: { component: { 'bom-ref': rootRef } }
  }
}

test('accepts a non-empty CycloneDX document', () => {
  const sbom = sbomWithComponents([
    {
      'bom-ref': 'react@19.2.3',
      licenses: [{ license: { id: 'MIT' } }],
      name: 'react',
      version: '19.2.3'
    }
  ])
  assert.equal(validateHarmonyReleaseSbom(sbom), sbom)
})

test('accepts the reviewed DOMPurify dual-license expression', () => {
  const sbom = sbomWithComponents([
    {
      'bom-ref': 'dompurify@3.4.14',
      licenses: [{ expression: '(MPL-2.0 OR Apache-2.0)' }],
      name: 'dompurify',
      version: '3.4.14'
    }
  ])

  assert.equal(validateHarmonyReleaseSbom(sbom), sbom)
})

test('fills the reviewed khroma license missing from npm metadata', () => {
  const sbom = deterministicHarmonyReleaseSbom(
    sbomWithComponents([
      {
        'bom-ref': 'khroma@2.1.0',
        name: 'khroma',
        version: '2.1.0'
      }
    ])
  )
  const khroma = sbom.components.find((component) => component.name === 'khroma')

  assert.deepEqual(khroma.licenses, [{ license: { id: 'MIT' } }])
  assert.equal(validateHarmonyReleaseSbom(sbom), sbom)
})

test('rejects empty or non-CycloneDX output', () => {
  assert.throws(
    () =>
      validateHarmonyReleaseSbom({
        bomFormat: 'SPDX',
        components: [{ licenses: [{ license: { id: 'MIT' } }] }]
      }),
    /invalid or empty/u
  )
  assert.throws(
    () => validateHarmonyReleaseSbom({ bomFormat: 'CycloneDX', components: [] }),
    /invalid or empty/u
  )
})

test('rejects missing or unreviewed production licenses', () => {
  for (const licenses of [[], [{ license: { id: 'GPL-3.0-only' } }]]) {
    assert.throws(
      () =>
        validateHarmonyReleaseSbom(
          sbomWithComponents([
            { 'bom-ref': 'dependency@1.0.0', licenses, name: 'dependency', version: '1.0.0' }
          ])
        ),
      /unreviewed license/u
    )
  }
})

test('rejects missing or duplicate component references', () => {
  for (const components of [
    [{ licenses: [{ license: { id: 'MIT' } }], name: 'missing', version: '1.0.0' }],
    [
      {
        'bom-ref': 'duplicate@1.0.0',
        licenses: [{ license: { id: 'MIT' } }],
        name: 'duplicate',
        version: '1.0.0'
      },
      {
        'bom-ref': 'duplicate@1.0.0',
        licenses: [{ license: { id: 'MIT' } }],
        name: 'duplicate',
        version: '1.0.0'
      }
    ]
  ]) {
    assert.throws(
      () => validateHarmonyReleaseSbom(sbomWithComponents(components)),
      /missing or duplicate component ref/u
    )
  }
})

test('rejects missing, duplicate, and dangling dependency graph references', () => {
  const component = {
    'bom-ref': 'dependency@1.0.0',
    licenses: [{ license: { id: 'MIT' } }],
    name: 'dependency',
    version: '1.0.0'
  }
  const cases = [
    (() => {
      const sbom = sbomWithComponents([component])
      sbom.dependencies[0].dependsOn = ['missing@1.0.0']
      return sbom
    })(),
    (() => {
      const sbom = sbomWithComponents([component])
      sbom.dependencies.push({ ref: 'missing@1.0.0', dependsOn: [] })
      return sbom
    })(),
    (() => {
      const sbom = sbomWithComponents([component])
      sbom.dependencies.pop()
      return sbom
    })(),
    (() => {
      const sbom = sbomWithComponents([component])
      sbom.dependencies.push({ ref: component['bom-ref'], dependsOn: [] })
      return sbom
    })()
  ]
  for (const sbom of cases) {
    assert.throws(() => validateHarmonyReleaseSbom(sbom), /dependency/u)
  }
})

test('adds OHPM lockfile packages without publishing local paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-sbom-test-'))
  const machineLocalPath = ['', 'Users', 'alice', 'private'].join('/')
  try {
    const projectLock = join(directory, 'oh-package-lock.json5')
    const entryLock = join(directory, 'entry-oh-package-lock.json5')
    writeFileSync(
      projectLock,
      `{
        packages: {
          'native@node_modules/native/native.har': {
            name: 'native', version: '1.2.3', license: 'MIT',
            resolved: 'node_modules/native/native.har',
            dependencies: { 'native-core': '1.0.0' }
          },
          'native-core@1.0.0': {
            name: 'native-core', version: '1.0.0', license: 'Apache-2.0',
            resolved: '${machineLocalPath}/native-core.har'
          }
        }
      }`
    )
    writeFileSync(entryLock, `{ packages: {} }`)
    const sbom = mergeHarmonyOhpmDependencies(
      {
        bomFormat: 'CycloneDX',
        components: [],
        dependencies: [{ ref: 'orca@1.0.0', dependsOn: [] }],
        metadata: { component: { 'bom-ref': 'orca@1.0.0' } }
      },
      [projectLock, entryLock],
      { harmonyRoot: directory, manifestPaths: [] }
    )
    assert.deepEqual(
      sbom.components.map((component) => component['bom-ref']),
      ['ohpm:native@1.2.3', 'ohpm:native-core@1.0.0']
    )
    assert.equal(sbom.components[0].licenses[0].license.id, 'MIT')
    assert.deepEqual(
      sbom.dependencies.find((item) => item.ref === 'ohpm:native@1.2.3'),
      {
        ref: 'ohpm:native@1.2.3',
        dependsOn: ['ohpm:native-core@1.0.0']
      }
    )
    assert.doesNotMatch(JSON.stringify(sbom), /Users\/alice|node_modules|native\.har/u)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('normalizes volatile npm metadata and unsafe references deterministically', () => {
  const machineLocalPath = ['', 'Users', 'alice', 'private'].join('/')
  const base = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    serialNumber: 'urn:uuid:random',
    metadata: {
      timestamp: '2026-08-31T00:00:00.000Z',
      component: {
        'bom-ref': 'orca@1.0.0',
        properties: [{ name: 'cdx:npm:package:path', value: '' }]
      }
    },
    components: [
      {
        'bom-ref': 'native@1.0.0',
        externalReferences: [
          { type: 'distribution', url: `file://${machineLocalPath}/native.har` },
          { type: 'distribution', url: 'https://registry.example/native.har?token=secret' }
        ],
        licenses: [{ license: { id: 'MIT' } }],
        name: 'native',
        properties: [{ name: 'cdx:npm:package:path', value: 'node_modules/first/native' }],
        version: '1.0.0'
      },
      {
        'bom-ref': 'native@1.0.0',
        externalReferences: [
          { type: 'distribution', url: `file://${machineLocalPath}/native.har` },
          { type: 'distribution', url: 'https://registry.example/native.har?token=secret' }
        ],
        licenses: [{ license: { id: 'MIT' } }],
        name: 'native',
        properties: [{ name: 'cdx:npm:package:path', value: 'node_modules/second/native' }],
        version: '1.0.0'
      }
    ],
    dependencies: [{ ref: 'orca@1.0.0', dependsOn: ['native@1.0.0'] }]
  }
  const first = deterministicHarmonyReleaseSbom(base)
  const second = deterministicHarmonyReleaseSbom({
    ...base,
    serialNumber: 'urn:uuid:different',
    metadata: { ...base.metadata, timestamp: '2026-08-31T01:00:00.000Z' }
  })
  assert.deepEqual(first, second)
  assert.equal(first.metadata.timestamp, undefined)
  assert.match(
    first.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  )
  assert.equal(first.components.length, 1)
  assert.deepEqual(first.components[0].externalReferences, [])
  assert.equal(first.components[0].properties, undefined)
  assert.doesNotMatch(JSON.stringify(first), /Users\/alice|token=secret|node_modules/u)
})

test('normalizes semantically unordered nested arrays deterministically', () => {
  const base = sbomWithComponents([
    {
      'bom-ref': 'native@1.0.0',
      licenses: [{ license: { id: 'MIT' } }, { license: { id: 'Apache-2.0' } }],
      name: 'native',
      version: '1.0.0'
    }
  ])
  const reversed = structuredClone(base)
  reversed.components[0].licenses.reverse()

  assert.deepEqual(deterministicHarmonyReleaseSbom(base), deterministicHarmonyReleaseSbom(reversed))
})

test('rejects conflicting duplicate component references during normalization', () => {
  assert.throws(
    () =>
      deterministicHarmonyReleaseSbom({
        bomFormat: 'CycloneDX',
        components: [
          { 'bom-ref': 'duplicate@1.0.0', name: 'duplicate', version: '1.0.0' },
          { 'bom-ref': 'duplicate@1.0.0', name: 'other', version: '1.0.0' }
        ]
      }),
    /conflicting component ref/u
  )
})
