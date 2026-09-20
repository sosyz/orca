import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { trimLandedImagePreviewDataUris } from './mobile-native-chat-landed-preview-budget'

const inline = (letter: string) => `data:image/png;base64,${letter.repeat(18)}`

function message(id: string, paths: string[]): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: paths.map((path) => ({ type: 'image-ref' as const, path })),
    timestamp: null,
    source: 'transcript'
  }
}

describe('landed image preview character budget', () => {
  it('evicts older inline images in place while keeping local URIs and newer scopes', () => {
    const oldImages = [inline('a'), 'file:///local-b.png', inline('b')]
    const oldSession = { old: oldImages, untouched: ['file:///local-c.png'] }
    const oldScope = { session: oldSession }
    const newImages = [inline('c')]
    const newScope = { session: { recent: newImages } }
    const scopes = new Map([
      ['old-scope', oldScope],
      ['new-scope', newScope]
    ])

    const changed = trimLandedImagePreviewDataUris(scopes, 80)

    expect([...changed.keys()]).toEqual(['old-scope'])
    expect(changed.get('old-scope')?.session.old).toEqual(['', 'file:///local-b.png', inline('b')])
    expect(changed.get('old-scope')?.session.untouched).toBe(oldSession.untouched)
    expect(oldScope.session.old).toBe(oldImages)
    expect(newScope.session.recent).toBe(newImages)
  })

  it('does not clone structures when inline previews fit the budget', () => {
    const scope = { session: { old: [inline('a'), 'content://local'] } }
    const scopes = new Map([['scope', scope]])

    expect(trimLandedImagePreviewDataUris(scopes, 40).size).toBe(0)
    expect(scopes.get('scope')).toBe(scope)
    expect(scopes.get('scope')?.session.old).toBe(scope.session.old)
  })

  it('uses session then message insertion order within a scope', () => {
    const scope = {
      olderSession: { first: [inline('a')], second: [inline('b')] },
      newerSession: { third: [inline('c')] }
    }

    const changed = trimLandedImagePreviewDataUris(new Map([['scope', scope]]), 80)

    expect(changed.get('scope')).toEqual({
      olderSession: { first: [''], second: [inline('b')] },
      newerSession: { third: [inline('c')] }
    })
    expect(changed.get('scope')?.newerSession).toBe(scope.newerSession)
  })

  it('keeps image positions and host path placeholders after partial or full eviction', () => {
    const scope = { session: { sent: [inline('a'), 'file:///local-b.png', inline('c')] } }
    const changed = trimLandedImagePreviewDataUris(new Map([['scope', scope]]), 40)
    const previews = changed.get('scope')!.session.sent
    const sent = message('sent', ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'])
    const rendered = buildMobileNativeChatTransientData({
      messages: [sent],
      folded: [sent],
      streaming: null,
      pending: [],
      imagePreviewsByMessageId: { sent: previews }
    })

    expect(rendered.data[0]?.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: '/tmp/b.png', url: 'file:///local-b.png' },
      { type: 'image-ref', path: '/tmp/c.png', url: inline('c') }
    ])

    const markerOnly = message('marker', [])
    const placeholders = buildMobileNativeChatTransientData({
      messages: [markerOnly],
      folded: [markerOnly],
      streaming: null,
      pending: [],
      imagePreviewsByMessageId: { marker: ['', ''] }
    })
    expect(placeholders.data[0]?.blocks).toEqual([
      { type: 'image-ref', url: '' },
      { type: 'image-ref', url: '' }
    ])
  })
})
