import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { create, extract } from 'tar'

function collectArchivePaths(root, currentPath = 'package', paths = []) {
  paths.push(currentPath.split(sep).join('/'))
  const absolutePath = join(root, currentPath)
  if (!lstatSync(absolutePath).isDirectory()) {
    return paths
  }
  for (const name of readdirSync(absolutePath).sort()) {
    collectArchivePaths(root, join(currentPath, name), paths)
  }
  return paths
}

function replaceGeneratedHar(sourcePath, targetPath) {
  try {
    renameSync(sourcePath, targetPath)
  } catch (error) {
    if (process.platform !== 'win32' || !existsSync(targetPath)) {
      throw error
    }
    const backupPath = `${targetPath}.orca-backup`
    rmSync(backupPath, { force: true })
    renameSync(targetPath, backupPath)
    try {
      renameSync(sourcePath, targetPath)
      rmSync(backupPath, { force: true })
    } catch (replacementError) {
      if (!existsSync(targetPath) && existsSync(backupPath)) {
        renameSync(backupPath, targetPath)
      }
      throw replacementError
    }
  }
}

export async function preparePatchedHarmonyHar({
  harmonyRoot,
  packageName,
  expectedVersion,
  moduleName,
  harName,
  harRelativePath = join('harmony', harName),
  files = [],
  transformArchive,
  logLabel
}) {
  const packageRoot = join(harmonyRoot, 'node_modules', ...packageName.split('/'))
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (packageJson.version !== expectedVersion) {
    throw new Error(`Unsupported ${logLabel} Harmony package ${packageJson.version}`)
  }

  const moduleRoot = join(packageRoot, 'harmony', moduleName)
  const sourceHarPath = join(packageRoot, harRelativePath)
  const generatedRoot = join(harmonyRoot, 'generated')
  const generatedHarPath = join(generatedRoot, harName)
  const temporaryRoot = mkdtempSync(join(tmpdir(), `orca-${moduleName}-har-`))
  try {
    const extractedRoot = join(temporaryRoot, 'extracted')
    mkdirSync(extractedRoot)
    await extract.asyncFile({ cwd: extractedRoot, file: sourceHarPath, strict: true }, [])

    for (const entry of files) {
      const sourcePath = join(moduleRoot, entry.relativePath)
      const patchedSource = readFileSync(sourcePath, 'utf8')
      for (const marker of entry.markers) {
        if (!patchedSource.includes(marker)) {
          throw new Error(`Patched ${logLabel} source is missing ${marker}`)
        }
      }
      const extractedPath = join(extractedRoot, 'package', entry.relativePath)
      if (readFileSync(extractedPath, 'utf8') !== patchedSource) {
        copyFileSync(sourcePath, extractedPath)
      }
    }
    await transformArchive?.(join(extractedRoot, 'package'))

    mkdirSync(generatedRoot, { recursive: true })
    const outputPath = join(temporaryRoot, harName)
    await create.asyncFile(
      {
        cwd: extractedRoot,
        file: outputPath,
        gzip: { level: 9 },
        mtime: new Date(0),
        noDirRecurse: true,
        portable: true
      },
      collectArchivePaths(extractedRoot)
    )
    replaceGeneratedHar(outputPath, generatedHarPath)
    console.log(`Prepared patched ${logLabel} HAR`)
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}
