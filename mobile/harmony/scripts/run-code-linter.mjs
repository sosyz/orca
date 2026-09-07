import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

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
    join(tmpdir(), 'orca-harmony-codelinter.log'),
    '--inIde',
    'false',
    '--isTooManyFiles',
    'false'
  ],
  { encoding: 'utf8' }
)

let checkedFiles = 0
const defects = []
const diagnostics = []
if (result.error) {
  diagnostics.push(`DevEco Code Linter failed to start: ${result.error.message}`)
}
for (const line of `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n')) {
  if (!line) {
    continue
  }
  try {
    const report = JSON.parse(line)
    if (Array.isArray(report.defects)) {
      checkedFiles += 1
      defects.push(...report.defects)
    } else if ([0, -1, -2].includes(report.messageType)) {
      diagnostics.push(report.content)
    }
  } catch {
    diagnostics.push(line)
  }
}

for (const diagnostic of diagnostics) {
  process.stderr.write(`${diagnostic}\n`)
}
for (const defect of defects) {
  process.stderr.write(
    `${defect._filePath ?? 'unknown'}:${defect.reportLine ?? 0}:${defect.reportColumn ?? 0} ${defect.ruleId ?? ''} ${defect.description ?? ''}\n`
  )
}
process.stdout.write(`Code Linter checked ${checkedFiles} reports; ${defects.length} defects.\n`)

const hasErrors = defects.some((defect) => defect.severity === 2)
const failedToRun = result.error !== undefined || result.status === null || checkedFiles === 0

process.exitCode = failedToRun || result.status !== 0 || hasErrors ? 1 : 0
