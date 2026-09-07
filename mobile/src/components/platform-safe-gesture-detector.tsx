import type { ComponentProps } from 'react'
import { Platform } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'

type Props = ComponentProps<typeof GestureDetector>

export function PlatformSafeGestureDetector({ children, ...props }: Props): React.JSX.Element {
  if ((Platform.OS as string) === 'harmony') {
    return <>{children}</>
  }

  return <GestureDetector {...props}>{children}</GestureDetector>
}
