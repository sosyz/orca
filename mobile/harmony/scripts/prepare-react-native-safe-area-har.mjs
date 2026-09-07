import { resolve } from 'node:path'
import { preparePatchedHarmonyHar } from './prepare-patched-harmony-har.mjs'

await preparePatchedHarmonyHar({
  harmonyRoot: resolve(import.meta.dirname, '..'),
  packageName: '@react-native-oh-tpl/react-native-safe-area-context',
  expectedVersion: '4.7.4-0.2.1',
  moduleName: 'safe_area',
  harName: 'safe_area.har',
  logLabel: 'react-native-safe-area-context',
  files: [
    {
      relativePath: 'src/main/ets/SafeViewTurboModule.ts',
      markers: [
        'window.AvoidAreaType.TYPE_CUTOUT',
        'Math.max(system.rightRect.width, cutout.rightRect.width, navigation.rightRect.width)',
        'Math.max(system.leftRect.width, cutout.leftRect.width, navigation.leftRect.width)'
      ]
    },
    {
      relativePath: 'src/main/ets/SafeAreaProvider.ets',
      markers: [
        "windowInstance.on('windowSizeChange'",
        "windowInstance.on('avoidAreaChange'",
        "this.windowInstance.off('windowSizeChange'",
        "this.windowInstance.off('avoidAreaChange'",
        'frame: data.frame'
      ]
    }
  ]
})
