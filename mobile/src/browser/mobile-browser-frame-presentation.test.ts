import { Buffer } from 'buffer'
import * as frameState from './mobile-browser-frame-state'
import type { Dispatch, SetStateAction } from 'react'
import type { Image, View } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame,
  type BrowserScreencastFrameMetadata
} from '../transport/browser-screencast-protocol'
import {
  clearBrowserFramePresentationQueue,
  handleBrowserFramePresentationError,
  handleBrowserFramePresentationLoad,
  presentMobileBrowserFrame,
  type BrowserFramePresentationRefs
} from './mobile-browser-frame-presentation'
import {
  clearCachedBrowserFramesForWorktree,
  makeBrowserFrameCacheKey,
  peekCachedBrowserFrame,
  type FrameLayer
} from './mobile-browser-frame-state'

const metadata: BrowserScreencastFrameMetadata = {
  deviceHeight: 640,
  deviceWidth: 360,
  pageScaleFactor: 1
}

function makeFrame(label: string): BrowserScreencastFrame {
  return {
    format: 'jpeg',
    image: Buffer.from(label),
    metadata,
    opcode: BrowserScreencastOpcode.Frame,
    seq: 1
  }
}

function frameUri(label: string): string {
  return `data:image/jpeg;base64,${Buffer.from(label).toString('base64')}`
}

function readSourceUri(value: unknown): string | null {
  const source = value && typeof value === 'object' ? (value as { source?: unknown }).source : null
  if (!Array.isArray(source)) {
    return null
  }
  const first = source[0]
  const uri = first && typeof first === 'object' ? (first as { uri?: unknown }).uri : null
  return typeof uri === 'string' ? uri : null
}

function setState<T>(slot: { current: T }): Dispatch<SetStateAction<T>> {
  return ((next: SetStateAction<T>) => {
    slot.current = typeof next === 'function' ? (next as (current: T) => T)(slot.current) : next
  }) as Dispatch<SetStateAction<T>>
}

function createRefs(): {
  refs: BrowserFramePresentationRefs
  layerSources: [string[], string[]]
  states: {
    frameMetadata: { current: BrowserScreencastFrameMetadata | null }
    frameUri: { current: string | null }
  }
} {
  const layerSources: [string[], string[]] = [[], []]
  const imageForLayer = (layer: FrameLayer): Image =>
    ({
      setNativeProps: vi.fn((props: unknown) => {
        const uri = readSourceUri(props)
        if (uri) {
          layerSources[layer].push(uri)
        }
      })
    }) as unknown as Image
  const refs: BrowserFramePresentationRefs = {
    browserImageRefs: { current: [imageForLayer(0), imageForLayer(1)] },
    browserLayerRefs: {
      current: [
        { setNativeProps: vi.fn() } as unknown as View,
        { setNativeProps: vi.fn() } as unknown as View
      ]
    },
    frameLayerFrameRef: { current: [null, null] },
    frameMetadataRef: { current: null },
    frameMountedRef: { current: false },
    frameUriRef: { current: null },
    pendingFrameLayerRef: { current: null },
    queuedFrameRef: { current: null },
    visibleFrameLayerRef: { current: 0 }
  }
  return {
    refs,
    layerSources,
    states: {
      frameMetadata: { current: null },
      frameUri: { current: null }
    }
  }
}

function loadEvent(uri?: string): unknown {
  return uri ? { nativeEvent: { source: { uri } } } : { nativeEvent: { source: {} } }
}

afterEach(() => {
  vi.restoreAllMocks()
  clearCachedBrowserFramesForWorktree('presentation-host', 'presentation-worktree')
})

describe('mobile browser frame presentation', () => {
  it('waits for the first image load before caching or marking input fresh', () => {
    const { refs, states } = createRefs()
    const onFrameCommit = vi.fn()
    const setters = {
      onFrameCommit,
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }
    const cacheKey = makeBrowserFrameCacheKey(
      'presentation-host',
      'presentation-worktree',
      'first-page',
      'web'
    )

    presentMobileBrowserFrame(refs, setters, makeFrame('first'), cacheKey)

    expect(refs.frameMountedRef.current).toBe(false)
    expect(states.frameUri.current).toBe(frameUri('first'))
    expect(peekCachedBrowserFrame(cacheKey)).toBeNull()
    expect(onFrameCommit).not.toHaveBeenCalled()

    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('first')))

    expect(refs.frameMountedRef.current).toBe(true)
    expect(peekCachedBrowserFrame(cacheKey)?.uri).toBe(frameUri('first'))
    expect(onFrameCommit).toHaveBeenCalledTimes(1)
  })

  it('only encodes frames that reach the native decoder when rendering falls behind', () => {
    const encode = vi.spyOn(frameState, 'createBrowserFrameDataUri')
    const { refs, layerSources, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }
    presentMobileBrowserFrame(refs, setters, makeFrame('first'), null)
    for (let index = 0; index < 100; index += 1) {
      presentMobileBrowserFrame(refs, setters, makeFrame(`pending-${index}`), null)
    }
    expect(encode).toHaveBeenCalledTimes(1)
    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('first')))
    expect(encode).toHaveBeenCalledTimes(2)
    expect(layerSources[1]).toEqual([frameUri('pending-99')])
  })

  it('keeps one hidden decode in flight and queues only the latest pending frame', () => {
    const { refs, layerSources, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }

    presentMobileBrowserFrame(refs, setters, makeFrame('visible'), null)
    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('visible')))
    presentMobileBrowserFrame(refs, setters, makeFrame('decode-1'), null)
    presentMobileBrowserFrame(refs, setters, makeFrame('decode-2'), null)

    expect(refs.visibleFrameLayerRef.current).toBe(0)
    expect(refs.pendingFrameLayerRef.current).toBe(1)
    expect(layerSources[1]).toEqual([frameUri('decode-1')])
    expect(refs.queuedFrameRef.current?.frame.image).toEqual(makeFrame('decode-2').image)

    handleBrowserFramePresentationLoad(refs, setters, 1, loadEvent(frameUri('decode-1')))

    expect(refs.visibleFrameLayerRef.current).toBe(1)
    expect(refs.pendingFrameLayerRef.current).toBe(0)
    expect(refs.frameUriRef.current).toBe(frameUri('decode-1'))
    expect(layerSources[0]).toEqual([frameUri('visible'), frameUri('decode-2')])
  })

  it('ignores stale image load events when a reset reuses the same hidden layer', () => {
    const { refs, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }

    presentMobileBrowserFrame(refs, setters, makeFrame('visible'), null)
    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('visible')))
    presentMobileBrowserFrame(refs, setters, makeFrame('stale'), null)
    clearBrowserFramePresentationQueue(refs)
    presentMobileBrowserFrame(refs, setters, makeFrame('fresh'), null)

    handleBrowserFramePresentationLoad(refs, setters, 1, loadEvent(frameUri('stale')))

    expect(refs.visibleFrameLayerRef.current).toBe(0)
    expect(refs.pendingFrameLayerRef.current).toBe(1)
    expect(refs.frameUriRef.current).toBe(frameUri('visible'))

    handleBrowserFramePresentationLoad(refs, setters, 1, loadEvent(frameUri('fresh')))

    expect(refs.visibleFrameLayerRef.current).toBe(1)
    expect(refs.pendingFrameLayerRef.current).toBeNull()
    expect(refs.frameUriRef.current).toBe(frameUri('fresh'))
  })

  it('does not cache a frame that fails hidden-layer decode', () => {
    const { refs, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }
    const cacheKey = makeBrowserFrameCacheKey(
      'presentation-host',
      'presentation-worktree',
      'presentation-page',
      'web'
    )

    presentMobileBrowserFrame(refs, setters, makeFrame('good'), cacheKey)
    expect(peekCachedBrowserFrame(cacheKey)).toBeNull()
    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('good')))
    presentMobileBrowserFrame(refs, setters, makeFrame('bad'), cacheKey)
    handleBrowserFramePresentationError(refs, setters, 1, loadEvent(frameUri('bad')))

    expect(peekCachedBrowserFrame(cacheKey)?.uri).toBe(frameUri('good'))
    expect(refs.frameUriRef.current).toBe(frameUri('good'))
  })

  it('keeps decoding the queued frame after the first frame fails', () => {
    const { refs, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }

    presentMobileBrowserFrame(refs, setters, makeFrame('bad-first'), null)
    presentMobileBrowserFrame(refs, setters, makeFrame('queued-first'), null)
    handleBrowserFramePresentationError(refs, setters, 0, loadEvent(frameUri('bad-first')))

    expect(refs.pendingFrameLayerRef.current).toBe(0)
    expect(states.frameUri.current).toBe(frameUri('queued-first'))

    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('queued-first')))

    expect(refs.frameMountedRef.current).toBe(true)
    expect(refs.frameUriRef.current).toBe(frameUri('queued-first'))
  })

  it('accepts native image load events without source uri for platform compatibility', () => {
    const { refs, states } = createRefs()
    const setters = {
      setFrameMetadata: setState(states.frameMetadata),
      setFrameUri: setState(states.frameUri)
    }

    presentMobileBrowserFrame(refs, setters, makeFrame('visible'), null)
    handleBrowserFramePresentationLoad(refs, setters, 0, loadEvent(frameUri('visible')))
    presentMobileBrowserFrame(refs, setters, makeFrame('compat'), null)
    handleBrowserFramePresentationLoad(refs, setters, 1, loadEvent())

    expect(refs.visibleFrameLayerRef.current).toBe(1)
    expect(refs.frameUriRef.current).toBe(frameUri('compat'))
  })
})
