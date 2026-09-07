import { hvigor, parseJsonFile, type HvigorNode, type HvigorPlugin } from '@ohos/hvigor'
import { appTasks, OhosPluginId } from '@ohos/hvigor-ohos-plugin'
import { createRNOHProjectPlugin } from '@rnoh/hvigor-plugin'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

type HarmonyBuildProfile = {
  app?: {
    products?: Array<{ name?: string; signingConfig?: string }>
    signingConfigs?: Array<{
      name?: string
      material?: { keyAlias?: string; profile?: string }
    }>
  }
}

function assertReleaseSigningProfile(): void {
  const profile = parseJsonFile(resolve('./build-profile.json5')) as HarmonyBuildProfile
  const product = profile.app?.products?.find(({ name }) => name === 'default')
  if (!product?.signingConfig) {
    return
  }
  const signingConfig = profile.app?.signingConfigs?.find(
    ({ name }) => name === product.signingConfig
  )
  if (!signingConfig) {
    throw new Error('[release-signing] Product references a missing signing configuration.')
  }
  if (/debug/i.test(`${signingConfig.name ?? ''} ${signingConfig.material?.keyAlias ?? ''}`)) {
    throw new Error('[release-signing] Refusing to sign a release HAP with a debug key.')
  }
  const signingProfilePath = signingConfig.material?.profile
  if (!signingProfilePath || !existsSync(signingProfilePath)) {
    throw new Error('[release-signing] Release signing profile is missing.')
  }
  const signingProfile = readFileSync(signingProfilePath)
  if (!signingProfile.includes(Buffer.from('"type":"release"'))) {
    throw new Error('[release-signing] Release build requires a release provisioning profile.')
  }
  if (!signingProfile.includes(Buffer.from('"bundle-name":"ai.stably.orca.harmony"'))) {
    throw new Error('[release-signing] Release profile targets the wrong bundle.')
  }
  if (signingProfile.includes(Buffer.from('"debug-info"'))) {
    throw new Error('[release-signing] Release profile must not contain a debug device allowlist.')
  }
  if (!signingProfile.includes(Buffer.from('ohos.permission.READ_PASTEBOARD'))) {
    throw new Error('[release-signing] Release profile does not grant the pasteboard ACL.')
  }
}

function isSigningEnabled(): boolean {
  const value = hvigor.getParameter().getProperty('enableSignTask')
  return value !== false && value !== 'false'
}

const releaseSigningGuard: HvigorPlugin = {
  pluginId: 'orcaReleaseSigningGuard',
  apply(currentNode: HvigorNode): void {
    hvigor.nodesEvaluated(() => {
      const appContext = currentNode.getContext(OhosPluginId.OHOS_APP_PLUGIN)
      if (appContext.getBuildMode() === 'release' && isSigningEnabled()) {
        assertReleaseSigningProfile()
      }
    })
  }
}

// Never package the legacy plaintext bundle after switching release builds to HBC.
rmSync(resolve('./entry/src/main/resources/rawfile/bundle.harmony.js'), { force: true })
// RNOH 0.84 resolves Hermes v1 from hermes-compiler; its Hvigor config no longer
// accepts a hermescDir field, so select that supported CLI default via the child environment.
process.env.HERMES_V1_ENABLED = 'true'

export default {
  system: appTasks,
  plugins: [
    releaseSigningGuard,
    createRNOHProjectPlugin({
      nodeModulesPath: './node_modules',
      bundler: {
        dev: false,
        entryFile: './index.js',
        config: './metro.config.js',
        bundleOutput: './entry/src/main/resources/rawfile/hermes_bundle.hbc',
        jsEngine: 'hermes',
        assetsDest: './entry/src/main/resources/rawfile/assets',
        minify: true,
        hermescOptions: 'O'
      }
    })
  ]
}
