import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./MobileBrowserPane.tsx', import.meta.url), 'utf8')

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('MobileBrowserPane source invariants', () => {
  it('keys the frame boundary by paired host worktree and page identity', () => {
    const boundaryBlock = sliceBetween(
      'export function MobileBrowserPane(props: MobileBrowserPaneProps) {',
      'function MobileBrowserPaneFrameBoundary({'
    )

    expect(boundaryBlock).toContain('key={makeMobileBrowserPaneBoundaryKey(')
    expect(boundaryBlock).toContain('props.pairedHostId')
    expect(boundaryBlock).toContain('props.worktreeId')
    expect(boundaryBlock).toContain('props.tab.browserPageId')
    expect(boundaryBlock).toContain('props.tab.id')
  })

  it('mirrors handler refs in a layout effect instead of during render', () => {
    const mirrorBlock = sliceBetween(
      'useLayoutEffect(() => {',
      '  useEffect(() => {\n    setFrameInputReady(false)'
    )

    expect(mirrorBlock).toContain('frameMetadataRef.current = frameMetadata')
    expect(mirrorBlock).toContain('layoutRef.current = layout')
    expect(mirrorBlock).toContain('dialogRef.current = dialog')
    expect(mirrorBlock).toContain('zoomRef.current = zoom')
    expect(mirrorBlock).toContain('}, [dialog, frameMetadata, layout, zoom])')
  })
})
