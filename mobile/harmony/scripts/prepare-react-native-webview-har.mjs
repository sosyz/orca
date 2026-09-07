import { resolve } from 'node:path'
import { preparePatchedHarmonyHar } from './prepare-patched-harmony-har.mjs'

await preparePatchedHarmonyHar({
  harmonyRoot: resolve(import.meta.dirname, '..'),
  packageName: '@react-native-oh-tpl/react-native-webview',
  expectedVersion: '13.10.3',
  moduleName: 'rn_webview',
  harName: 'rn_webview.har',
  logLabel: 'react-native-webview',
  files: [
    {
      relativePath: 'src/main/ets/Magic.ets',
      markers: [
        'allowFileAccess: boolean',
        "mixedContentMode: 'never' | 'always' | 'compatibility'"
      ]
    },
    {
      relativePath: 'src/main/ets/RNCWebView.ets',
      markers: [
        'this.registerPostMessage(false)',
        'private registerPostMessage(reloadAfterRegistration: boolean = true)',
        'this.allowFileAccess = this.descriptorWrapper.rawProps.allowFileAccess === true',
        'if (this.controllerAttached && this.hasRegisterJavaScriptProxy)'
      ]
    },
    {
      relativePath: 'src/main/ets/WebViewBaseOperate.ets',
      markers: ["this.eventEmitter!.emit('contentProcessDidTerminate'"]
    }
  ]
})
