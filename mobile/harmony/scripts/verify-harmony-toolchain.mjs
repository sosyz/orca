#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const harmonyRoot = resolve(import.meta.dirname, '..')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  assert(value, `Set ${name} before verifying the Harmony toolchain`)
  return value
}

function commandVersion(command, args, name) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  assert(!result.error && result.status === 0, `Unable to read ${name} version`)
  const match = `${result.stdout}\n${result.stderr}`.match(/\d+\.\d+\.\d+/u)
  assert(match, `Unable to parse ${name} version`)
  return match[0]
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function normalizedRelativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

export function hashToolchainDirectory(rootPath) {
  const root = realpathSync(resolve(rootPath))
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, 'en')
    )
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const name = normalizedRelativePath(root, path)
      if (entry.isDirectory()) {
        digest.update(`directory\0${name}\0`)
        visit(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path)
        assert(
          target === root || target.startsWith(`${root}${sep}`),
          `Toolchain symlink escapes the pinned root: ${name}`
        )
        digest.update(`symlink\0${name}\0${readlinkSync(path)}\0`)
        continue
      }
      assert(entry.isFile(), `Unsupported toolchain entry: ${name}`)
      digest.update(`file\0${name}\0${statSync(path).size}\0`)
      const descriptor = openSync(path, 'r')
      try {
        for (let bytesRead = readSync(descriptor, buffer); bytesRead > 0;) {
          digest.update(buffer.subarray(0, bytesRead))
          bytesRead = readSync(descriptor, buffer)
        }
      } finally {
        closeSync(descriptor)
      }
      digest.update('\0')
    }
  }

  visit(root)
  return digest.digest('hex')
}

export function verifyHarmonyToolchainSnapshot(expected, actual) {
  for (const key of [
    'codeLinterContentSha256',
    'devEcoNode',
    'devEcoNodeContentSha256',
    'hapSignToolSha256',
    'hvigor',
    'hvigorContentSha256',
    'java',
    'javaContentSha256',
    'node',
    'npm',
    'ohpm',
    'ohpmContentSha256',
    'platform',
    'sdkApi',
    'sdkContentSha256',
    'sdkVersion'
  ]) {
    assert(actual[key] === expected[key], `Harmony toolchain ${key} is not pinned`)
  }
  assert(
    JSON.stringify(actual.sdkComponents) === JSON.stringify(expected.sdkComponents),
    'Harmony SDK component set is not pinned'
  )
  return actual
}

export function inspectHarmonyToolchain() {
  const expected = JSON.parse(
    readFileSync(join(harmonyRoot, 'release-toolchain-pins.json'), 'utf8')
  )
  const devEcoHome = resolve(requiredEnvironment('DEVECO_HOME'))
  const codeLinterRoot = join(devEcoHome, 'plugins', 'codelinter')
  const devEcoNodeRoot = join(devEcoHome, 'tools', 'node')
  const devEcoNode = join(
    devEcoNodeRoot,
    process.platform === 'win32' ? 'node.exe' : join('bin', 'node')
  )
  const javaHome = resolve(requiredEnvironment('JAVA_HOME'))
  const hvigor = resolve(requiredEnvironment('HARMONY_HVIGORW'))
  const ohpm = resolve(requiredEnvironment('HARMONY_OHPM'))
  const java = join(javaHome, 'bin', 'java')
  const sdkRoot = join(requiredEnvironment('DEVECO_SDK_HOME'), 'default', 'openharmony')
  const signTool = resolve(requiredEnvironment('HAP_SIGN_TOOL_JAR'))
  assert(existsSync(join(codeLinterRoot, 'index.js')), 'Harmony Code Linter is missing')
  assert(existsSync(devEcoNode), 'Harmony DevEco embedded Node is missing')
  const components = expected.sdkComponents.map((component) => {
    const metadata = JSON.parse(
      readFileSync(join(sdkRoot, component, 'oh-uni-package.json'), 'utf8')
    )
    return { api: Number(metadata.apiVersion), name: component, version: metadata.version }
  })
  const apiVersions = new Set(components.map((component) => component.api))
  const sdkVersions = new Set(components.map((component) => component.version))
  assert(apiVersions.size === 1, 'Harmony SDK components use different API versions')
  assert(sdkVersions.size === 1, 'Harmony SDK components use different releases')

  return verifyHarmonyToolchainSnapshot(expected, {
    codeLinterContentSha256: hashToolchainDirectory(codeLinterRoot),
    devEcoNode: commandVersion(devEcoNode, ['--version'], 'DevEco embedded Node'),
    devEcoNodeContentSha256: hashToolchainDirectory(devEcoNodeRoot),
    hapSignToolSha256: sha256(signTool),
    hvigor: commandVersion(hvigor, ['--version'], 'Hvigor'),
    hvigorContentSha256: hashToolchainDirectory(dirname(dirname(hvigor))),
    java: commandVersion(java, ['-version'], 'Java'),
    javaContentSha256: hashToolchainDirectory(javaHome),
    node: process.versions.node,
    npm: commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], 'npm'),
    ohpm: commandVersion(ohpm, ['--version'], 'OHPM'),
    ohpmContentSha256: hashToolchainDirectory(dirname(dirname(ohpm))),
    platform: `${process.platform}-${process.arch}`,
    sdkApi: [...apiVersions][0],
    sdkComponents: components.map((component) => component.name),
    sdkContentSha256: hashToolchainDirectory(sdkRoot),
    sdkVersion: [...sdkVersions][0]
  })
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const snapshot = inspectHarmonyToolchain()
  const evidencePath = process.env.HARMONY_RELEASE_TOOLCHAIN_EVIDENCE_PATH?.trim()
  if (evidencePath) {
    writeFileSync(resolve(evidencePath), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  }
  console.log(
    `[release-toolchain] Verified Node ${snapshot.node}, npm ${snapshot.npm}, Java ${snapshot.java}, ` +
      `DevEco Node ${snapshot.devEcoNode}, Code Linter, Hvigor ${snapshot.hvigor}, ` +
      `OHPM ${snapshot.ohpm}, SDK ${snapshot.sdkVersion}.`
  )
}
