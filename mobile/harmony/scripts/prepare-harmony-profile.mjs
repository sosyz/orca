import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  hardenLocalSigningProfilePermissions,
  LOCAL_SIGNING_PROFILE_NAMES
} from './harmony-local-signing-profile-policy.mjs'

const harmonyRoot = resolve(import.meta.dirname, '..')
const profilePath = resolve(harmonyRoot, 'build-profile.json5')

if (!existsSync(profilePath)) {
  copyFileSync(resolve(harmonyRoot, 'build-profile.template.json5'), profilePath)
  console.info('Created unsigned build-profile.json5 from the tracked template')
}

for (const name of LOCAL_SIGNING_PROFILE_NAMES) {
  hardenLocalSigningProfilePermissions(resolve(harmonyRoot, name))
}
