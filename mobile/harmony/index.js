import 'react-native-url-polyfill/auto'
import 'react-native-gesture-handler'
import { AppRegistry } from 'react-native'
import { name as appName } from './app.json'
import { HarmonyApp } from './src/HarmonyApp'

AppRegistry.registerComponent(appName, () => HarmonyApp)
