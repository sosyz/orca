import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mergeHarmonyOhpmDependencies } from './generate-harmony-release-sbom.mjs'

function baseSbom() {
  return {
    bomFormat: 'CycloneDX',
    components: [],
    dependencies: [{ ref: 'orca@1.0.0', dependsOn: [] }],
    metadata: { component: { 'bom-ref': 'orca@1.0.0' } }
  }
}

function withLocks(projectPackages, entryPackages, run) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-ohpm-graph-test-'))
  const entryDirectory = join(directory, 'entry')
  mkdirSync(entryDirectory)
  const projectLock = join(directory, 'oh-package-lock.json5')
  const entryLock = join(entryDirectory, 'oh-package-lock.json5')
  writeFileSync(projectLock, JSON.stringify({ packages: projectPackages }, null, 2))
  writeFileSync(entryLock, JSON.stringify({ packages: entryPackages }, null, 2))
  try {
    return run(directory, [projectLock, entryLock])
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('deduplicates equivalent OHPM records whose local paths resolve identically', () => {
  withLocks(
    {
      'native@project': {
        name: 'native',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'node_modules/native.har'
      }
    },
    {
      'native@entry': {
        name: 'native',
        version: '1.0.0',
        license: 'MIT',
        resolved: '../node_modules/native.har'
      }
    },
    (directory, locks) => {
      const sbom = mergeHarmonyOhpmDependencies(baseSbom(), locks, {
        harmonyRoot: directory,
        manifestPaths: []
      })
      assert.deepEqual(
        sbom.components.map((component) => component['bom-ref']),
        ['ohpm:native@1.0.0']
      )
    }
  )
})

test('rejects conflicting OHPM records with the same component identity', () => {
  withLocks(
    {
      'native@1.0.0': {
        name: 'native',
        version: '1.0.0',
        license: 'MIT',
        integrity: 'sha512-first',
        resolved: 'https://example.test/native.har'
      }
    },
    {
      'native@1.0.0': {
        name: 'native',
        version: '1.0.0',
        license: 'MIT',
        integrity: 'sha512-second',
        resolved: 'https://example.test/native.har'
      }
    },
    (directory, locks) => {
      assert.throws(
        () =>
          mergeHarmonyOhpmDependencies(baseSbom(), locks, {
            harmonyRoot: directory,
            manifestPaths: []
          }),
        /conflicting OHPM lock record/u
      )
    }
  )
})

test('resolves an exact OHPM dependency to one installed version', () => {
  withLocks(
    {
      'parent@1.0.0': {
        name: 'parent',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://example.test/parent.har',
        dependencies: { child: '1.0.0' }
      },
      'child@1.0.0': {
        name: 'child',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://example.test/child-1.har'
      },
      'child@2.0.0': {
        name: 'child',
        version: '2.0.0',
        license: 'MIT',
        resolved: 'https://example.test/child-2.har'
      }
    },
    {},
    (directory, locks) => {
      const sbom = mergeHarmonyOhpmDependencies(baseSbom(), locks, {
        harmonyRoot: directory,
        manifestPaths: []
      })
      assert.deepEqual(
        sbom.dependencies.find((dependency) => dependency.ref === 'ohpm:parent@1.0.0'),
        { ref: 'ohpm:parent@1.0.0', dependsOn: ['ohpm:child@1.0.0'] }
      )
    }
  )
})

test('adds only manifest direct dependencies to the SBOM root', () => {
  withLocks(
    {
      'direct@1.0.0': {
        name: 'direct',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://example.test/direct.har',
        dependencies: { transitive: '1.0.0' }
      },
      'transitive@1.0.0': {
        name: 'transitive',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://example.test/transitive.har'
      }
    },
    {
      'entry-direct@1.0.0': {
        name: 'entry-direct',
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://example.test/entry-direct.har'
      }
    },
    (directory, locks) => {
      const projectManifest = join(directory, 'oh-package.json5')
      const entryManifest = join(directory, 'entry', 'oh-package.json5')
      writeFileSync(projectManifest, JSON.stringify({ dependencies: { direct: '1.0.0' } }))
      writeFileSync(entryManifest, JSON.stringify({ dependencies: { 'entry-direct': '1.0.0' } }))
      const sbom = mergeHarmonyOhpmDependencies(baseSbom(), locks, {
        harmonyRoot: directory,
        manifestPaths: [projectManifest, entryManifest]
      })
      assert.deepEqual(
        sbom.dependencies.find((dependency) => dependency.ref === 'orca@1.0.0'),
        {
          ref: 'orca@1.0.0',
          dependsOn: ['ohpm:direct@1.0.0', 'ohpm:entry-direct@1.0.0']
        }
      )
      assert.deepEqual(
        sbom.dependencies.find((dependency) => dependency.ref === 'ohpm:direct@1.0.0'),
        { ref: 'ohpm:direct@1.0.0', dependsOn: ['ohpm:transitive@1.0.0'] }
      )
    }
  )
})

test('fails closed for missing or ambiguous OHPM dependencies', () => {
  for (const dependency of [
    { name: 'missing', specifier: '1.0.0' },
    { name: 'child', specifier: '^1.0.0' }
  ]) {
    withLocks(
      {
        'parent@1.0.0': {
          name: 'parent',
          version: '1.0.0',
          license: 'MIT',
          resolved: 'https://example.test/parent.har',
          dependencies: { [dependency.name]: dependency.specifier }
        },
        'child@1.0.0': {
          name: 'child',
          version: '1.0.0',
          license: 'MIT',
          resolved: 'https://example.test/child-1.har'
        },
        'child@2.0.0': {
          name: 'child',
          version: '2.0.0',
          license: 'MIT',
          resolved: 'https://example.test/child-2.har'
        }
      },
      {},
      (directory, locks) => {
        assert.throws(
          () =>
            mergeHarmonyOhpmDependencies(baseSbom(), locks, {
              harmonyRoot: directory,
              manifestPaths: []
            }),
          /cannot uniquely resolve OHPM dependency/u
        )
      }
    )
  }
})
