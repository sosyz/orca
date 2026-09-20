import { resolve } from 'node:path'
import { preparePatchedHarmonyHar } from './prepare-patched-harmony-har.mjs'
import { patchReactNativeCoreTextInput } from './react-native-core-text-input-patch.mjs'

await preparePatchedHarmonyHar({
  harmonyRoot: resolve(import.meta.dirname, '..'),
  packageName: '@react-native-oh/react-native-harmony',
  expectedVersion: '0.84.3',
  moduleName: 'react_native_openharmony',
  harName: 'react_native_openharmony.har',
  harRelativePath: 'react_native_openharmony.har',
  logLabel: 'react-native-core',
  transformArchive: patchReactNativeCoreTextInput
})
