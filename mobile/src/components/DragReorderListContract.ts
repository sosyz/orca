import type { ReactNode } from 'react'
import type { ScrollView } from 'react-native'
import type { AnimatedRef, SharedValue } from 'react-native-reanimated'

export type DragReorderListProps<ItemT> = {
  items: ItemT[]
  itemKey: (item: ItemT) => string
  rowHeight: number
  renderRow: (item: ItemT) => ReactNode
  /** Called with every item key in the new order after a drop changes it. */
  onReorder: (orderedKeys: string[]) => void
  /** Lets the owning screen disable its ScrollView while a row is held. */
  onDragActiveChange?: (active: boolean) => void
  scrollRef: AnimatedRef<ScrollView>
  scrollOffsetY: SharedValue<number>
  scrollContentHeight: SharedValue<number>
}
