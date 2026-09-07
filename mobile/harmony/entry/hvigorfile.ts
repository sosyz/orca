import { hapTasks } from '@ohos/hvigor-ohos-plugin'
import { createRNOHModulePlugin } from '@rnoh/hvigor-plugin'

export default {
  system: hapTasks,
  plugins: [
    createRNOHModulePlugin({
      nodeModulesPath: './node_modules',
      codegen: {
        projectRootPath: './',
        rnohModulePath: './oh_modules/@rnoh/react-native-openharmony'
      },
      autolinking: null
    })
  ]
}
