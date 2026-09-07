import RootLayout from '../../app/_layout'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { HarmonyRouterProvider } from './navigation/harmony-router'

export function HarmonyApp(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <HarmonyRouterProvider>
        <RootLayout />
      </HarmonyRouterProvider>
    </SafeAreaProvider>
  )
}
