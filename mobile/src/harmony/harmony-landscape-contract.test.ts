import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mobileRoot = resolve(import.meta.dirname, '../..')

describe('Harmony landscape contract', () => {
  it('allows user-controlled rotation instead of pinning the Ability to portrait', () => {
    const manifest = readFileSync(
      resolve(mobileRoot, 'harmony/entry/src/main/module.json5'),
      'utf8'
    )

    expect(manifest).toMatch(
      /abilities:\s*\[\s*\{[\s\S]*?name: 'EntryAbility'[\s\S]*?        orientation: 'auto_rotation_restricted',[\s\S]*?        skills:/u
    )
  })

  it('keeps session and file-preview controls out of landscape side cutouts', () => {
    const session = readFileSync(
      resolve(mobileRoot, 'app/h/[hostId]/session/[worktreeId].tsx'),
      'utf8'
    )
    const preview = readFileSync(
      resolve(mobileRoot, 'src/files/MobileFilePreviewScreen.tsx'),
      'utf8'
    )

    expect(session).toContain(
      'isLandscape && { paddingLeft: insets.left, paddingRight: insets.right }'
    )
    expect(
      session.match(/\[styles\.markdownFrame, \{ paddingBottom: insets\.bottom \}\]/gu)
    ).toHaveLength(1)
    expect(session).toContain('<RetainedSessionDocumentSurfaces')
    expect(preview).toContain("edges={isLandscape ? ['left', 'right', 'bottom'] : ['bottom']}")
    expect(preview).toContain('onLayout={handlePreviewBodyLayout}')
    expect(preview).toContain('previewBodySize.width - spacing.md * 2')
    expect(preview).toContain('previewBodySize.height - spacing.md * 2')
    expect(preview).not.toContain('useWindowDimensions')
  })
})
