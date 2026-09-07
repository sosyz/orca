import { describe, expect, it } from 'vitest'
import {
  getTerminalPaneWebViewState,
  getTerminalWebViewPlatformPolicy,
  shouldArmTerminalBridgeAutoRecovery,
  shouldRunTerminalForegroundRecovery
} from './terminal-webview-platform-policy'

describe('terminal WebView platform policy', () => {
  it('keeps inactive iOS and Android terminal WebViews mounted', () => {
    expect(
      getTerminalPaneWebViewState({
        active: false,
        covered: false,
        platform: 'ios'
      })
    ).toEqual({
      hiddenPanePresentation: 'opacity-hidden',
      shouldMountWebView: true,
      webViewActive: false
    })
    expect(
      getTerminalPaneWebViewState({
        active: false,
        covered: false,
        platform: 'android'
      }).shouldMountWebView
    ).toBe(true)
  })

  it('mounts Harmony ArkWeb only for the visible uncovered pane', () => {
    expect(
      getTerminalPaneWebViewState({
        active: false,
        covered: false,
        platform: 'harmony'
      })
    ).toEqual({
      hiddenPanePresentation: 'display-none',
      shouldMountWebView: false,
      webViewActive: false
    })
    expect(
      getTerminalPaneWebViewState({
        active: true,
        covered: true,
        platform: 'harmony'
      })
    ).toMatchObject({
      shouldMountWebView: false,
      webViewActive: false
    })
    expect(
      getTerminalPaneWebViewState({
        active: true,
        covered: false,
        platform: 'harmony'
      })
    ).toMatchObject({
      shouldMountWebView: true,
      webViewActive: true
    })
  })

  it('centralizes bridge, WebGL, reload, and foreground recovery differences', () => {
    expect(getTerminalWebViewPlatformPolicy('harmony')).toMatchObject({
      bridgeAutoRecovery: 'foreground-visible-once',
      bridgeReadiness: 'native-ack-gated',
      foregroundRecovery: 'remount-surface',
      reloadStrategy: 'remount-surface',
      webglEnabled: false
    })
    expect(getTerminalWebViewPlatformPolicy('ios')).toMatchObject({
      bridgeAutoRecovery: 'none',
      bridgeReadiness: 'direct',
      foregroundRecovery: 'probe-mounted-document',
      reloadStrategy: 'native-reload',
      webglEnabled: true
    })
    expect(getTerminalWebViewPlatformPolicy('android')).toMatchObject({
      bridgeAutoRecovery: 'none',
      bridgeReadiness: 'direct',
      foregroundRecovery: 'none',
      reloadStrategy: 'native-reload',
      webglEnabled: true
    })
  })

  it('runs foreground recovery only for platforms with an explicit recovery policy', () => {
    expect(shouldRunTerminalForegroundRecovery('background', 'active', 'ios')).toBe(true)
    expect(shouldRunTerminalForegroundRecovery('inactive', 'active', 'harmony')).toBe(true)
    expect(shouldRunTerminalForegroundRecovery('background', 'active', 'android')).toBe(false)
    expect(shouldRunTerminalForegroundRecovery('active', 'active', 'ios')).toBe(false)
    expect(shouldRunTerminalForegroundRecovery('background', 'inactive', 'harmony')).toBe(false)
  })

  it('arms Harmony bridge auto recovery only while the surface is foreground visible', () => {
    const harmonyPolicy = getTerminalWebViewPlatformPolicy('harmony')
    const iosPolicy = getTerminalWebViewPlatformPolicy('ios')

    expect(
      shouldArmTerminalBridgeAutoRecovery({
        active: true,
        appState: 'active',
        policy: harmonyPolicy
      })
    ).toBe(true)
    expect(
      shouldArmTerminalBridgeAutoRecovery({
        active: true,
        appState: 'background',
        policy: harmonyPolicy
      })
    ).toBe(false)
    expect(
      shouldArmTerminalBridgeAutoRecovery({
        active: false,
        appState: 'active',
        policy: harmonyPolicy
      })
    ).toBe(false)
    expect(
      shouldArmTerminalBridgeAutoRecovery({
        active: true,
        appState: 'active',
        policy: iosPolicy
      })
    ).toBe(false)
  })
})
