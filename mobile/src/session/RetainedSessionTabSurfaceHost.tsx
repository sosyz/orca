import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { View } from 'react-native'
import { resolveRetainedSessionSurfaceIds } from './retained-session-surface-order'

type RetainedSessionSurface = {
  id: string
}

type RetainedSessionTabSurfaceHostProps<T extends RetainedSessionSurface> = {
  activeId: string | null
  frameStyle: StyleProp<ViewStyle>
  hiddenFrameStyle: StyleProp<ViewStyle>
  renderSurface: (surface: T, active: boolean) => ReactNode
  surfaces: readonly T[]
  visible: boolean
}

export function RetainedSessionTabSurfaceHost<T extends RetainedSessionSurface>({
  activeId,
  frameStyle,
  hiddenFrameStyle,
  renderSurface,
  surfaces,
  visible
}: RetainedSessionTabSurfaceHostProps<T>) {
  const [retainedIds, setRetainedIds] = useState<readonly string[]>([])
  const liveIds = useMemo(() => new Set(surfaces.map((surface) => surface.id)), [surfaces])
  const renderedIds = resolveRetainedSessionSurfaceIds({
    activeId: visible ? activeId : null,
    liveIds,
    previousIds: retainedIds
  })

  useLayoutEffect(() => {
    setRetainedIds(renderedIds)
  }, [renderedIds])

  const surfaceById = useMemo(
    () => new Map(surfaces.map((surface) => [surface.id, surface])),
    [surfaces]
  )
  const retainedSurfaces = renderedIds
    .map((id) => surfaceById.get(id))
    .filter((surface): surface is T => surface != null)

  if (!visible && retainedSurfaces.length === 0) {
    return null
  }

  return (
    <>
      {retainedSurfaces.map((surface) => {
        const active = visible && surface.id === activeId
        return (
          <View
            key={surface.id}
            pointerEvents={active ? 'auto' : 'none'}
            style={[frameStyle, !active && hiddenFrameStyle]}
          >
            {renderSurface(surface, active)}
          </View>
        )
      })}
    </>
  )
}
