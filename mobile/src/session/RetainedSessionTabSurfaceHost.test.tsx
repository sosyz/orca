import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetainedSessionTabSurfaceHost } from './RetainedSessionTabSurfaceHost'

vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children?: unknown }) => createElement('View', props, children)
}))

const frameStyle = { flex: 1 }
const hiddenFrameStyle = { display: 'none' as const }
const lifecycle = {
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>()
}

function Surface({ active, id }: { active: boolean; id: string }) {
  useEffect(() => {
    lifecycle.mounts.set(id, (lifecycle.mounts.get(id) ?? 0) + 1)
    return () => {
      lifecycle.unmounts.set(id, (lifecycle.unmounts.get(id) ?? 0) + 1)
    }
  }, [id])
  return createElement('Surface', { active, id })
}

function host({
  activeId,
  ids,
  visible
}: {
  activeId: string | null
  ids: readonly string[]
  visible: boolean
}) {
  return createElement(RetainedSessionTabSurfaceHost, {
    activeId,
    frameStyle,
    hiddenFrameStyle,
    renderSurface: (surface: { id: string }, active: boolean) =>
      createElement(Surface, { active, id: surface.id }),
    surfaces: ids.map((id) => ({ id })),
    visible
  })
}

function surfaces(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('Surface')
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  lifecycle.mounts.clear()
  lifecycle.unmounts.clear()
  vi.clearAllMocks()
})

describe('RetainedSessionTabSurfaceHost', () => {
  it('keeps first-visit order and hides inactive retained surfaces', () => {
    act(() => {
      renderer = create(host({ activeId: 'doc-a', ids: ['doc-a', 'doc-b'], visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeId: 'doc-b', ids: ['doc-a', 'doc-b'], visible: true }))
    })

    expect(surfaces(renderer!).map((surface) => [surface.props.id, surface.props.active])).toEqual([
      ['doc-a', false],
      ['doc-b', true]
    ])
    expect(lifecycle.mounts.get('doc-a')).toBe(1)
    expect(lifecycle.mounts.get('doc-b')).toBe(1)

    act(() => {
      renderer?.update(host({ activeId: 'doc-a', ids: ['doc-a', 'doc-b'], visible: true }))
    })

    expect(surfaces(renderer!).map((surface) => [surface.props.id, surface.props.active])).toEqual([
      ['doc-a', true],
      ['doc-b', false]
    ])
    expect(lifecycle.mounts.get('doc-a')).toBe(1)
    expect(lifecycle.mounts.get('doc-b')).toBe(1)
    expect(lifecycle.unmounts.size).toBe(0)
  })

  it('prunes only surfaces no longer present in the live tab list', () => {
    act(() => {
      renderer = create(host({ activeId: 'doc-a', ids: ['doc-a', 'doc-b'], visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeId: 'doc-b', ids: ['doc-a', 'doc-b'], visible: true }))
    })
    act(() => {
      renderer?.update(host({ activeId: null, ids: ['doc-a', 'doc-b'], visible: false }))
    })

    expect(surfaces(renderer!).map((surface) => surface.props.active)).toEqual([false, false])

    act(() => {
      renderer?.update(host({ activeId: null, ids: ['doc-a'], visible: false }))
    })

    expect(surfaces(renderer!).map((surface) => surface.props.id)).toEqual(['doc-a'])
    expect(lifecycle.unmounts.get('doc-a')).toBeUndefined()
    expect(lifecycle.unmounts.get('doc-b')).toBe(1)
  })
})
