import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PRComment } from '../../../../src/shared/github/comment-types'
import { PRCommentCard } from './PRCommentCard'

vi.mock('react-native', () => ({
  Image: 'Image',
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  CornerDownRight: 'CornerDownRight',
  ExternalLink: 'ExternalLink',
  Pencil: 'Pencil',
  Trash2: 'Trash2',
  Undo2: 'Undo2'
}))

vi.mock('../../theme/mobile-emoji-font-family', () => ({
  mobileEmojiTextStyle: { fontFamily: 'Orca Emoji' }
}))

vi.mock('../ConfirmModal', () => ({ ConfirmModal: 'ConfirmModal' }))
vi.mock('./CommentMarkdown', () => ({ CommentMarkdown: 'CommentMarkdown' }))
vi.mock('./PRCommentComposer', () => ({ PRCommentComposer: 'PRCommentComposer' }))

function comment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: 1,
    author: 'octocat',
    authorAvatarUrl: '',
    body: 'Looks good',
    createdAt: '2026-01-01T00:00:00Z',
    url: '',
    ...overrides
  }
}

describe('PRCommentCard', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders reaction emoji with the embedded Harmony emoji font style', () => {
    act(() => {
      renderer = create(
        createElement(PRCommentCard, {
          comment: comment({ reactions: [{ content: 'rocket', count: 2 }] }),
          now: Date.parse('2026-01-02T00:00:00Z')
        })
      )
    })

    const rocket = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.children.join('') === '🚀')
    expect(rocket?.props.style).toEqual(expect.objectContaining({ fontFamily: 'Orca Emoji' }))
    expect(rocket?.props.style).not.toHaveProperty('fontSize')
  })
})
