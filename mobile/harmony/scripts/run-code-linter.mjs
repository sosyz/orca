import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectCodeLinterResult, listNativeLintSources } from './code-linter-result.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const defaultDevEcoHome =
  process.platform === 'darwin' ? '/Applications/DevEco-Studio.app/Contents' : undefined
const devEcoHome = process.env.DEVECO_HOME ?? defaultDevEcoHome

if (!devEcoHome) {
  throw new Error('Set DEVECO_HOME to the DevEco Studio installation directory.')
}

const codeLinterRoot = join(devEcoHome, 'plugins', 'codelinter')
const codeLinterEntry = join(codeLinterRoot, 'index.js')
const devEcoNodeCandidates = [
  join(devEcoHome, 'tools', 'node', 'bin', 'node'),
  join(devEcoHome, 'tools', 'node', 'node.exe')
]
const devEcoNode = devEcoNodeCandidates.find(existsSync)

if (!devEcoNode || !existsSync(codeLinterEntry)) {
  throw new Error(`DevEco Code Linter was not found below ${devEcoHome}.`)
}

const sdkPath = process.env.DEVECO_SDK_HOME ?? join(devEcoHome, 'sdk')
const logPath = join(tmpdir(), 'orca-harmony-codelinter.log')
const result = spawnSync(
  devEcoNode,
  [
    codeLinterEntry,
    '--config',
    join(projectRoot, 'code-linter.json5'),
    '--dir',
    JSON.stringify([join(projectRoot, 'entry', 'src', 'main', 'ets')]),
    '--project',
    projectRoot,
    '--product',
    'default',
    '--workdir',
    codeLinterRoot,
    '--sdkPath',
    sdkPath,
    '--sdkNumberVersion',
    process.env.HARMONY_SDK_API_LEVEL ?? '21',
    '--sdkStringVersion',
    process.env.HARMONY_SDK_VERSION ?? '6.0.1',
    '--logPath',
    logPath,
    '--inIde',
    'false',
    '--isTooManyFiles',
    'false'
  ],
  { encoding: 'utf8' }
)

const expectedSources = listNativeLintSources(join(projectRoot, 'entry', 'src', 'main', 'ets'))
const inspection = inspectCodeLinterResult(result, expectedSources)

for (const failure of inspection.failures) {
  process.stderr.write(`${failure}\n`)
}
if (inspection.failures.length > 0) {
  process.stderr.write(`DevEco Code Linter log: ${logPath}\n`)
}
if (
  inspection.failures.some((failure) => failure.includes('incomplete report results')) &&
  process.platform === 'darwin' &&
  process.arch === 'arm64'
) {
  const binary = join(codeLinterRoot, 'performanceAgent', 'hpaudit')
  const architectures = spawnSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' })
  if (
    architectures.status === 0 &&
    architectures.stdout.includes('x86_64') &&
    !architectures.stdout.includes('arm64')
  ) {
    const rosetta = spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], {
      encoding: 'utf8'
    })
    if (rosetta.status !== 0) {
      process.stderr.write(
        `DevEco performanceAgent/hpaudit is x86_64-only and cannot run on this arm64 Mac; Code Linter results are incomplete.\n`
      )
    }
  }
}
for (const defect of inspection.defects) {
  process.stderr.write(
    `${defect._filePath ?? 'unknown'}:${defect.reportLine ?? 0}:${defect.reportColumn ?? 0} ${defect.ruleId ?? ''} ${defect.description ?? ''}\n`
  )
}
process.stdout.write(
  `Code Linter checked ${inspection.reportCount} reports for ${inspection.sourceCount} ArkTS sources; ${inspection.defects.length} defects.\n`
)

process.exitCode = inspection.failures.length > 0 ? 1 : 0
