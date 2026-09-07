import { forwardRef } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'
import Animated from 'react-native-reanimated'

// RNOH exports ScrollView as a function component, while Reanimated requires a
// ref-capable component. This adapter also keeps the same behavior on iOS/Android.
const RefForwardingScrollView = forwardRef<ScrollView, ScrollViewProps>((props, ref) => (
  <ScrollView ref={ref} {...props} />
))

RefForwardingScrollView.displayName = 'RefForwardingScrollView'

export const ReanimatedScrollView = Animated.createAnimatedComponent(RefForwardingScrollView)
