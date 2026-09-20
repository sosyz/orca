import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { View } from 'react-native'
import type { Terminal } from './mobile-session-route-types'
import { resolveRetainedSessionSurfaceIds } from './retained-session-surface-order'
import { TerminalPaneView, type TerminalPaneViewProps } from './TerminalPaneView'

type RetainedTerminalPaneHostProps = Omit<
  TerminalPaneViewProps,
  'active' | 'covered' | 'handle' | 'keyboardLift' | 'retained' | 'terminalTheme'
> & {
  activeHandle: string | null
  children?: ReactNode
  covered: boolean
  frameStyle: StyleProp<ViewStyle>
  hiddenFrameStyle: StyleProp<ViewStyle>
  keyboardLift: number
  onLayout?: (event: LayoutChangeEvent) => void
  terminals: readonly Terminal[]
  visible: boolean
}

export function RetainedTerminalPaneHost({
  activeHandle,
  children,
  covered,
  frameStyle,
  hiddenFrameStyle,
  keyboardLift,
  onLayout,
  terminals,
  visible,
  ...paneProps
}: RetainedTerminalPaneHostProps) {
  const [retainedHandles, setRetainedHandles] = useState<readonly string[]>([])
  const liveHandles = useMemo(
    () => new Set(terminals.map((terminal) => terminal.handle)),
    [terminals]
  )
  const renderedHandles = resolveRetainedSessionSurfaceIds({
    activeId: visible ? activeHandle : null,
    liveIds: liveHandles,
    previousIds: retainedHandles
  })

  useLayoutEffect(() => {
    setRetainedHandles(renderedHandles)
  }, [renderedHandles])

  const terminalByHandle = useMemo(
    () => new Map(terminals.map((terminal) => [terminal.handle, terminal])),
    [terminals]
  )
  const retainedTerminals = renderedHandles
    .map((handle) => terminalByHandle.get(handle))
    .filter((terminal): terminal is Terminal => terminal != null)

  if (!visible && retainedTerminals.length === 0) {
    return null
  }

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[frameStyle, !visible && hiddenFrameStyle]}
      onLayout={visible ? onLayout : undefined}
    >
      {retainedTerminals.map((terminal) => {
        const active = visible && terminal.handle === activeHandle
        return (
          <TerminalPaneView
            key={terminal.handle}
            {...paneProps}
            active={active}
            covered={active && covered}
            handle={terminal.handle}
            keyboardLift={active ? keyboardLift : 0}
            retained
            terminalTheme={terminal.terminalTheme}
          />
        )
      })}
      {visible ? children : null}
    </View>
  )
}
