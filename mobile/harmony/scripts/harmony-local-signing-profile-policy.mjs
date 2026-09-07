import { chmodSync, lstatSync } from 'node:fs'

export const LOCAL_SIGNING_PROFILE_NAMES = [
  'build-profile.json5',
  'build-profile.local-backup.json5'
]

function localSigningProfileStat(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Local signing profile must be a regular file')
  }
  return stat
}

export function hardenLocalSigningProfilePermissions(path, platform = process.platform) {
  const stat = localSigningProfileStat(path)
  if (platform !== 'win32' && stat) {
    chmodSync(path, 0o600)
  }
}

export function validateLocalSigningProfile({
  ignored,
  path,
  platform = process.platform,
  relativePath,
  tracked
}) {
  const stat = localSigningProfileStat(path)
  if (!stat) {
    return
  }
  if (tracked) {
    throw new Error(`Local signing profile must not be tracked: ${relativePath}`)
  }
  if (!ignored) {
    throw new Error(`Local signing profile must remain ignored: ${relativePath}`)
  }
  if (platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`Local signing profile permissions must be 0600: ${relativePath}`)
  }
}
