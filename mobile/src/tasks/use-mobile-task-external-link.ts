import { useCallback, useLayoutEffect, useRef } from 'react'
import { Alert, Linking } from 'react-native'
import { openMobileTaskExternalLink } from './mobile-task-external-link'

export function useMobileTaskExternalLink(hostId: string): (url: string) => Promise<void> {
  const scopeRef = useRef({ mounted: false })

  useLayoutEffect(() => {
    const scope = { mounted: true }
    scopeRef.current = scope
    return () => {
      scope.mounted = false
    }
  }, [hostId])

  return useCallback((url: string): Promise<void> => {
    const requestedScope = scopeRef.current
    return openMobileTaskExternalLink({
      url,
      openURL: (targetUrl) => Linking.openURL(targetUrl),
      showFailure: (title, message) => Alert.alert(title, message),
      isMounted: () => requestedScope.mounted && scopeRef.current === requestedScope
    })
  }, [])
}
