import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../../src/shared/github/pull-request-types'
import type { MobilePrTitleAction } from '../../session/use-mobile-pr-title-action'
import { PRSidebarHeader } from './PRSidebarHeader'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  ArrowRight: 'ArrowRight',
  ExternalLink: 'ExternalLink',
  Pencil: 'Pencil'
}))
vi.mock('../mobile-pr-url', () => ({ openMobilePrUrl: vi.fn() }))
vi.mock('./mobile-pr-sidebar-styles', () => ({ mobilePrSidebarStyles: {} }))
vi.mock('./pr-comment-composer-styles', () => ({ prCommentComposerStyles: {} }))

const repo = { owner: 'Orca', repo: 'Client' }
const titleAction = {
  ready: true,
  saving: false,
  error: null,
  clearError: vi.fn(),
  setTitle: vi.fn().mockResolvedValue(true)
} as MobilePrTitleAction
let renderer: ReactTestRenderer | null = null

function render(pr: PRInfo) {
  const element = createElement(PRSidebarHeader, {
    pr,
    details: null,
    titleAction,
    bare: true
  })
  act(() => {
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

function pr(number: number, prRepo = repo): PRInfo {
  return { number, title: `Title ${number}`, state: 'open', prRepo } as PRInfo
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

describe('PR title editor identity', () => {
  it('discards an in-progress draft when ready PR number changes', () => {
    render(pr(7))
    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: 'Edit pull request title' }).props.onPress()
    )
    act(() => renderer!.root.findByType('TextInput').props.onChangeText('Old PR draft'))
    render(pr(8))

    expect(renderer!.root.findAllByType('TextInput')).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Save title' })).toHaveLength(0)
    expect(titleAction.setTitle).not.toHaveBeenCalled()
  })

  it('discards a draft for a different Enterprise repository with the same PR number', () => {
    render(pr(7))
    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: 'Edit pull request title' }).props.onPress()
    )
    act(() => renderer!.root.findByType('TextInput').props.onChangeText('Old repository draft'))
    render(pr(7, { ...repo, host: 'github.enterprise.test' }))

    expect(renderer!.root.findAllByType('TextInput')).toHaveLength(0)
  })

  it('keeps the draft through a refresh of the same canonical repository and PR', () => {
    render(pr(7))
    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: 'Edit pull request title' }).props.onPress()
    )
    act(() => renderer!.root.findByType('TextInput').props.onChangeText('Keep my draft'))
    render(pr(7, { host: 'github.com', owner: 'orca', repo: 'client' }))

    expect(renderer!.root.findByType('TextInput').props.value).toBe('Keep my draft')
  })
})
