const path = require('node:path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const { createHarmonyMetroConfig } = require('@react-native-oh/react-native-harmony/metro.config')

const projectRoot = __dirname
const mobileRoot = path.resolve(projectRoot, '..')
const sharedRoot = path.resolve(mobileRoot, '..', 'src', 'shared')
const compatRoot = path.resolve(projectRoot, 'src', 'compat')
const harmonyConfig = createHarmonyMetroConfig({
  reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony'
})
const resolveHarmonyRequest = harmonyConfig.resolver.resolveRequest

const moduleAliases = {
  '@noble/hashes/crypto': path.resolve(
    projectRoot,
    'node_modules',
    '@noble',
    'hashes',
    'crypto.js'
  ),
  '@orca/expo-two-way-audio': path.resolve(compatRoot, 'expo-two-way-audio.ts'),
  'expo-camera': path.resolve(compatRoot, 'expo-camera.tsx'),
  'expo-clipboard': path.resolve(compatRoot, 'expo-clipboard.ts'),
  'expo-constants': path.resolve(compatRoot, 'expo-constants.ts'),
  'expo-crypto': path.resolve(compatRoot, 'expo-crypto.ts'),
  'expo-document-picker': path.resolve(compatRoot, 'expo-document-picker.ts'),
  'expo-file-system': path.resolve(compatRoot, 'expo-file-system.ts'),
  'expo-haptics': path.resolve(compatRoot, 'expo-haptics.ts'),
  'expo-image-manipulator': path.resolve(compatRoot, 'expo-image-manipulator.ts'),
  'expo-image-picker': path.resolve(compatRoot, 'expo-image-picker.ts'),
  'expo-keep-awake': path.resolve(compatRoot, 'expo-keep-awake.ts'),
  'expo-linking': path.resolve(compatRoot, 'expo-linking.ts'),
  'expo-network': path.resolve(compatRoot, 'expo-network.ts'),
  'expo-notifications': path.resolve(compatRoot, 'expo-notifications.ts'),
  'expo-router': path.resolve(projectRoot, 'src', 'navigation', 'harmony-router.tsx'),
  'expo-secure-store': path.resolve(compatRoot, 'expo-secure-store.ts'),
  'expo-splash-screen': path.resolve(compatRoot, 'expo-splash-screen.ts'),
  'expo-status-bar': path.resolve(compatRoot, 'expo-status-bar.tsx')
}

const config = {
  watchFolders: [mobileRoot, sharedRoot],
  resolver: {
    disableHierarchicalLookup: true,
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
    resolveRequest: (context, moduleName, platform) => {
      const filePath = moduleAliases[moduleName]
      if (filePath) {
        return { filePath, type: 'sourceFile' }
      }
      return resolveHarmonyRequest(context, moduleName, platform)
    }
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true
      }
    })
  }
}

module.exports = mergeConfig(getDefaultConfig(projectRoot), harmonyConfig, config)
