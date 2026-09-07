#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const JSON5 = require('json5')
const harmonyRoot = resolve(import.meta.dirname, '..')
const defaultOhpmLockPaths = [
  join(harmonyRoot, 'oh-package-lock.json5'),
  join(harmonyRoot, 'entry/oh-package-lock.json5')
]
const ALLOWED_RUNTIME_LICENSES = new Set([
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '(MPL-2.0 OR Apache-2.0)',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense'
])
const REVIEWED_RUNTIME_LICENSE_OVERRIDES = new Map([['khroma@2.1.0', 'MIT']])

function licenseValues(value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry
      }
      return entry?.expression ?? entry?.license?.id ?? entry?.license?.name
    })
    .filter((license) => typeof license === 'string' && license.length > 0)
}

function componentRef(name, version) {
  return `ohpm:${name}@${version}`
}

function packageUrl(name, version) {
  return `pkg:generic/${encodeURIComponent(name).replaceAll('%2F', '/')}@${encodeURIComponent(version)}`
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value
      .map(stableObject)
      .sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])])
  )
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function componentReference(component) {
  return typeof component?.['bom-ref'] === 'string' ? component['bom-ref'] : ''
}

function safeExternalReference(reference) {
  if (!reference || typeof reference.url !== 'string') {
    return false
  }
  try {
    const url = new URL(reference.url)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function normalizeNpmComponent(component) {
  if (Array.isArray(component?.externalReferences)) {
    component.externalReferences = component.externalReferences.filter(safeExternalReference)
  }
  if (Array.isArray(component?.properties)) {
    component.properties = component.properties.filter(
      (property) => property?.name !== 'cdx:npm:package:path'
    )
    if (component.properties.length === 0) {
      delete component.properties
    }
  }
  if (licenseValues(component?.licenses).length === 0) {
    const license = REVIEWED_RUNTIME_LICENSE_OVERRIDES.get(
      `${component?.name}@${component?.version}`
    )
    if (license) {
      component.licenses = [{ license: { id: license } }]
    }
  }
}

function normalizeNpmSbom(sbom) {
  const normalized = structuredClone(sbom)
  delete normalized.serialNumber
  delete normalized.metadata?.timestamp
  normalizeNpmComponent(normalized.metadata?.component)
  for (const component of normalized.components ?? []) {
    normalizeNpmComponent(component)
  }
  return normalized
}

function uniqueComponents(components) {
  const byReference = new Map()
  for (const component of components) {
    const reference = componentReference(component)
    if (!reference) {
      throw new Error('Harmony SBOM component is missing bom-ref')
    }
    const normalized = stableObject(component)
    const existing = byReference.get(reference)
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new Error(`Harmony SBOM contains conflicting component ref: ${reference}`)
    }
    byReference.set(reference, existing ?? normalized)
  }
  return [...byReference.values()]
}

function uniqueDependencies(dependencies) {
  const byReference = new Map()
  for (const dependency of dependencies) {
    const reference = typeof dependency?.ref === 'string' ? dependency.ref : ''
    if (!reference) {
      throw new Error('Harmony SBOM dependency is missing ref')
    }
    const normalized = stableObject({
      ...dependency,
      dependsOn: [...new Set(dependency.dependsOn ?? [])].sort()
    })
    const existing = byReference.get(reference)
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new Error(`Harmony SBOM contains conflicting dependency ref: ${reference}`)
    }
    byReference.set(reference, existing ?? normalized)
  }
  return [...byReference.values()]
}

function installedLicense(harmonyPackageRoot, name, version) {
  const packagePath = join(harmonyPackageRoot, 'node_modules', ...name.split('/'), 'package.json')
  const candidates = [packagePath]
  const ohpmRoot = join(harmonyPackageRoot, 'oh_modules', '.ohpm')
  if (existsSync(ohpmRoot)) {
    const pending = [ohpmRoot]
    while (pending.length > 0) {
      const directory = pending.pop()
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const candidate = join(directory, entry.name)
        if (entry.isDirectory()) {
          pending.push(candidate)
        } else if (entry.name === 'oh-package.json5') {
          candidates.push(candidate)
        }
      }
    }
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue
    }
    try {
      const metadata = JSON5.parse(readFileSync(candidate, 'utf8'))
      const licenses = licenseValues(metadata.license ?? metadata.licenses)
      if (metadata.name === name && String(metadata.version) === version && licenses.length > 0) {
        return licenses
      }
    } catch {
      // An optional package manifest may not exist before OHPM installation.
    }
  }
  return []
}

function readOhpmLock(path) {
  const resolvedPath = resolve(path)
  const lock = JSON5.parse(readFileSync(resolvedPath, 'utf8'))
  return { path: resolvedPath, lock }
}

function normalizedOhpmRecord(record, lockPath) {
  const normalized = structuredClone(record)
  if (typeof normalized.resolved === 'string') {
    if (/^https?:\/\//iu.test(normalized.resolved)) {
      normalized.resolved = new URL(normalized.resolved).href
    } else {
      normalized.resolved = resolve(dirname(lockPath), normalized.resolved.replace(/^file:/u, ''))
    }
  }
  return stableObject(normalized)
}

function ohpmRecords(lockFiles) {
  const records = new Map()
  for (const { lock, path } of lockFiles) {
    for (const record of Object.values(lock.packages ?? {})) {
      const name = typeof record?.name === 'string' ? record.name.trim() : ''
      const version = typeof record?.version === 'string' ? record.version.trim() : ''
      if (!name || !version) {
        continue
      }
      const key = `${name}@${version}`
      const previous = records.get(key)
      const fingerprint = JSON.stringify(normalizedOhpmRecord(record, path))
      if (previous && previous.fingerprint !== fingerprint) {
        throw new Error(`Harmony SBOM contains conflicting OHPM lock record: ${key}`)
      }
      records.set(
        key,
        previous ?? {
          dependencies: { ...record.dependencies },
          fingerprint,
          licenses: [...new Set(licenseValues(record.license ?? record.licenses))],
          name,
          version
        }
      )
    }
  }
  return records
}

function readOhpmRootDependencies(manifestPaths) {
  return manifestPaths.flatMap((path) => {
    const manifest = JSON5.parse(readFileSync(resolve(path), 'utf8'))
    return Object.entries(manifest.dependencies ?? {})
  })
}

function ohpmRecordsByName(records) {
  const byName = new Map()
  for (const record of records.values()) {
    byName.set(record.name, [...(byName.get(record.name) ?? []), record])
  }
  return byName
}

function resolveOhpmDependencyReference(byName, name, specifier) {
  const candidates = byName.get(name) ?? []
  if (candidates.length === 1) {
    return componentRef(candidates[0].name, candidates[0].version)
  }
  const exact = candidates.filter((candidate) => candidate.version === specifier)
  if (exact.length === 1) {
    return componentRef(exact[0].name, exact[0].version)
  }
  throw new Error(`Harmony SBOM cannot uniquely resolve OHPM dependency: ${name}@${specifier}`)
}

function normalizeOhpmComponent(record, npmSbom, harmonyPackageRoot) {
  const existing = npmSbom.components.find(
    (component) => component.name === record.name && component.version === record.version
  )
  const licenses = [
    ...new Set([
      ...record.licenses,
      ...licenseValues(existing?.licenses),
      ...installedLicense(harmonyPackageRoot, record.name, record.version)
    ])
  ]
  const component = {
    'bom-ref': componentRef(record.name, record.version),
    type: 'library',
    name: record.name,
    version: record.version,
    scope: 'required',
    purl: packageUrl(record.name, record.version),
    properties: [{ name: 'cdx:component:ecosystem', value: 'ohpm' }]
  }
  if (licenses.length > 0) {
    component.licenses = licenses.map((license) => ({ license: { id: license } }))
  }
  return component
}

function addOhpmDependencies(sbom, records, rootDependencies) {
  const byName = ohpmRecordsByName(records)
  const dependencies = new Map(
    uniqueDependencies(sbom.dependencies ?? []).map((dependency) => [dependency.ref, dependency])
  )
  for (const record of records.values()) {
    const ref = componentRef(record.name, record.version)
    const dependsOn = Object.entries(record.dependencies ?? {})
      .map(([name, specifier]) => resolveOhpmDependencyReference(byName, name, String(specifier)))
      .filter((dependencyRef) => dependencyRef !== ref)
    dependencies.set(ref, { ref, dependsOn: [...new Set(dependsOn)].sort() })
  }
  const root = sbom.metadata?.component?.['bom-ref']
  if (root && dependencies.has(root)) {
    const rootDependency = dependencies.get(root)
    rootDependency.dependsOn = [
      ...new Set([
        ...(rootDependency.dependsOn ?? []),
        ...rootDependencies.map(([name, specifier]) =>
          resolveOhpmDependencyReference(byName, name, String(specifier))
        )
      ])
    ].sort()
  }
  sbom.dependencies = [...dependencies.values()]
}

export function mergeHarmonyOhpmDependencies(sbom, lockPaths = defaultOhpmLockPaths, options = {}) {
  const lockFiles = lockPaths.map(readOhpmLock)
  const records = ohpmRecords(lockFiles)
  const harmonyPackageRoot = resolve(options.harmonyRoot ?? harmonyRoot)
  const rootDependencies = readOhpmRootDependencies(
    options.manifestPaths ?? [
      join(harmonyPackageRoot, 'oh-package.json5'),
      join(harmonyPackageRoot, 'entry/oh-package.json5')
    ]
  )
  sbom.components = [
    ...(sbom.components ?? []),
    ...[...records.values()].map((record) =>
      normalizeOhpmComponent(record, sbom, harmonyPackageRoot)
    )
  ]
  addOhpmDependencies(sbom, records, rootDependencies)
  return sbom
}

export function deterministicHarmonyReleaseSbom(sbom) {
  const normalized = normalizeNpmSbom(sbom)
  normalized.components = uniqueComponents(normalized.components ?? []).sort((left, right) =>
    compareStrings(componentReference(left), componentReference(right))
  )
  normalized.dependencies = uniqueDependencies(normalized.dependencies ?? []).sort((left, right) =>
    compareStrings(String(left.ref), String(right.ref))
  )
  const withoutSerial = stableObject(normalized)
  const digest = createHash('sha256').update(JSON.stringify(withoutSerial)).digest('hex')
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)
  normalized.serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  return stableObject(normalized)
}

export function validateHarmonyReleaseSbom(sbom) {
  if (
    sbom?.bomFormat !== 'CycloneDX' ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    throw new Error('npm produced an invalid or empty CycloneDX SBOM')
  }
  const componentRefs = new Set()
  for (const component of sbom.components) {
    const reference = componentReference(component)
    if (!reference || componentRefs.has(reference)) {
      throw new Error(`Harmony SBOM contains a missing or duplicate component ref: ${reference}`)
    }
    componentRefs.add(reference)
    const licenses = licenseValues(component.licenses)
    if (
      licenses.length === 0 ||
      licenses.some((license) => !ALLOWED_RUNTIME_LICENSES.has(license))
    ) {
      throw new Error(
        `Harmony runtime dependency has an unreviewed license: ${component.name}@${component.version}`
      )
    }
  }
  const rootRef = componentReference(sbom.metadata?.component)
  if (!rootRef) {
    throw new Error('Harmony SBOM metadata component is missing bom-ref')
  }
  const knownRefs = new Set([rootRef, ...componentRefs])
  const dependencyRefs = new Set()
  for (const dependency of sbom.dependencies ?? []) {
    const reference = typeof dependency?.ref === 'string' ? dependency.ref : ''
    if (!reference || dependencyRefs.has(reference)) {
      throw new Error(`Harmony SBOM contains a missing or duplicate dependency ref: ${reference}`)
    }
    if (!knownRefs.has(reference)) {
      throw new Error(`Harmony SBOM dependency ref is dangling: ${reference}`)
    }
    dependencyRefs.add(reference)
    for (const target of dependency.dependsOn ?? []) {
      if (!knownRefs.has(target)) {
        throw new Error(`Harmony SBOM dependency target is dangling: ${target}`)
      }
    }
  }
  for (const reference of knownRefs) {
    if (!dependencyRefs.has(reference)) {
      throw new Error(`Harmony SBOM dependency graph is missing: ${reference}`)
    }
  }
  return sbom
}

export function generateHarmonyReleaseSbom(outputPath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(
    npm,
    ['sbom', '--omit=dev', '--sbom-format=cyclonedx', '--sbom-type=application'],
    { cwd: harmonyRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (result.error || result.status !== 0) {
    throw new Error('Unable to generate the Harmony production SBOM')
  }
  let sbom
  try {
    sbom = JSON.parse(result.stdout)
  } catch {
    throw new Error('npm produced invalid JSON for the Harmony production SBOM')
  }
  const lockPaths = [
    process.env.HARMONY_OHPM_PROJECT_LOCK_PATH ?? defaultOhpmLockPaths[0],
    process.env.HARMONY_OHPM_ENTRY_LOCK_PATH ?? defaultOhpmLockPaths[1]
  ]
  sbom = mergeHarmonyOhpmDependencies(sbom, lockPaths)
  sbom = deterministicHarmonyReleaseSbom(sbom)
  validateHarmonyReleaseSbom(sbom)
  writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`)
  return { components: sbom.components.length, output: basename(outputPath) }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const outputArgument = process.argv[2]
  if (!outputArgument) {
    throw new Error('Usage: generate-harmony-release-sbom.mjs <output.cdx.json>')
  }
  const result = generateHarmonyReleaseSbom(resolve(outputArgument))
  console.log(`[release-sbom] Wrote ${result.output} with ${result.components} components.`)
}
