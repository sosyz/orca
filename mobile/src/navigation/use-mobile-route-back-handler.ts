import { useEffect } from 'react'
import { BackHandler } from 'react-native'
import { useNavigation } from 'expo-router'

type RouteBackHandlingNavigation = {
  registerBackHandler?: (handler: () => boolean) => () => void
}

export function useMobileRouteBackHandler(handler: () => boolean): void {
  const navigation = useNavigation<RouteBackHandlingNavigation>()

  useEffect(() => {
    if (typeof navigation.registerBackHandler === 'function') {
      return navigation.registerBackHandler(handler)
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler)
    return () => subscription.remove()
  }, [handler, navigation])
}
