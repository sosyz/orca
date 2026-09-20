import { useMemo, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { MobileBrowserPane } from '../browser/MobileBrowserPane'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileSessionTab } from './mobile-session-route-types'
import { RetainedSessionTabSurfaceHost } from './RetainedSessionTabSurfaceHost'

type BrowserTab = Extract<MobileSessionTab, { type: 'browser' }>

type RetainedSessionBrowserSurfacesProps = {
  activeTab: BrowserTab | null
  bottomInset: number
  client: RpcClient | null
  frameStyle: StyleProp<ViewStyle>
  hiddenFrameStyle: StyleProp<ViewStyle>
  keyboardLift: number
  onToast: (message: string, durationMs?: number) => void
  pairedHostId: string
  screencastSupported: boolean | null
  tabs: readonly MobileSessionTab[]
  toast?: ReactNode
  worktreeId: string
}

function isBrowserTab(tab: MobileSessionTab): tab is BrowserTab {
  return tab.type === 'browser'
}

export function RetainedSessionBrowserSurfaces({
  activeTab,
  bottomInset,
  client,
  frameStyle,
  hiddenFrameStyle,
  keyboardLift,
  onToast,
  pairedHostId,
  screencastSupported,
  tabs,
  toast,
  worktreeId
}: RetainedSessionBrowserSurfacesProps) {
  const browserTabs = useMemo(() => tabs.filter(isBrowserTab), [tabs])

  return (
    <RetainedSessionTabSurfaceHost
      activeId={activeTab?.id ?? null}
      frameStyle={frameStyle}
      hiddenFrameStyle={hiddenFrameStyle}
      surfaces={browserTabs}
      visible={activeTab != null}
      renderSurface={(tab, active) => (
        <>
          <MobileBrowserPane
            active={active}
            bottomInset={bottomInset}
            client={client}
            keyboardLift={keyboardLift}
            pairedHostId={pairedHostId}
            screencastSupported={screencastSupported}
            tab={tab}
            worktreeId={worktreeId}
            onToast={onToast}
          />
          {active ? toast : null}
        </>
      )}
    />
  )
}
