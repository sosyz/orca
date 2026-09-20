import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileRepoIcon } from './MobileRepoIcon'

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Bot: 'Bot',
  Box: 'Box',
  Braces: 'Braces',
  Briefcase: 'Briefcase',
  Building2: 'Building2',
  Code2: 'Code2',
  Cpu: 'Cpu',
  Database: 'Database',
  Folder: 'Folder',
  Gauge: 'Gauge',
  Globe: 'Globe',
  Layers: 'Layers',
  Package: 'Package',
  Palette: 'Palette',
  Rocket: 'Rocket',
  Server: 'Server',
  Shapes: 'Shapes',
  Sparkles: 'Sparkles',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))

vi.mock('../theme/mobile-emoji-font-family', () => ({
  mobileEmojiTextStyle: { fontFamily: 'Orca Emoji' }
}))

describe('MobileRepoIcon', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders emoji repo icons with the embedded Harmony emoji font style', () => {
    act(() => {
      renderer = create(
        createElement(MobileRepoIcon, {
          repoIcon: { type: 'emoji', emoji: '🚀' },
          size: 18
        })
      )
    })

    const emoji = renderer!.root.findByType('Text' as never)
    expect(emoji.props.children).toBe('🚀')
    expect(emoji.props.style).toEqual([
      expect.objectContaining({ fontFamily: 'Orca Emoji', textAlign: 'center' }),
      { fontSize: 18 }
    ])
  })
})
