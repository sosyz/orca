import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CameraView, useCameraPermissions } from '../../harmony/src/compat/expo-camera'

const native = vi.hoisted(() => ({
  scanPairingCode: vi.fn<() => Promise<string | null>>()
}))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('../../harmony/node_modules/react-native/index.js', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('../../harmony/node_modules/react/index.js', async () => {
  return vi.importActual<typeof import('react')>('react')
})

vi.mock('../../harmony/src/native/harmony-native-module', () => ({
  HarmonyNative: { scanPairingCode: native.scanPairingCode },
  hasHarmonyNativeModule: () => true
}))

describe('Harmony camera compatibility adapter', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    native.scanPairingCode.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('offers an explicit retry after cancellation and relaunches scanning', async () => {
    native.scanPairingCode.mockResolvedValueOnce(null).mockResolvedValueOnce('orca://pair?code=abc')
    const onBarcodeScanned = vi.fn()

    await act(async () => {
      renderer = create(createElement(CameraView, { onBarcodeScanned }))
    })

    expect(native.scanPairingCode).toHaveBeenCalledTimes(1)
    const retry = renderer!.root.findByType('Pressable')
    expect(retry.props.accessibilityLabel).toBe('Scan pairing code again')

    await act(async () => retry.props.onPress())

    expect(native.scanPairingCode).toHaveBeenCalledTimes(2)
    expect(onBarcodeScanned).toHaveBeenCalledWith({
      data: 'orca://pair?code=abc',
      type: 'qr'
    })
  })

  it('distinguishes a Scan Kit failure from user cancellation', async () => {
    native.scanPairingCode.mockRejectedValueOnce(new Error('Scan Kit failed'))

    await act(async () => {
      renderer = create(createElement(CameraView, { onBarcodeScanned: vi.fn() }))
    })

    const messages = renderer!.root.findAllByType('Text').map((node) => node.props.children)
    expect(messages).toContain('Scanner unavailable')
  })

  it('models the camera-preauthorized Scan Kit default UI as granted', async () => {
    function PermissionProbe() {
      const [permission] = useCameraPermissions()
      return createElement('Text', null, permission.granted ? permission.status : 'denied')
    }

    await act(async () => {
      renderer = create(createElement(PermissionProbe))
    })

    expect(renderer!.root.findByType('Text').props.children).toBe('granted')
  })

  it('does not request app camera permission for Scan Kit default UI', () => {
    const harmonyRoot = resolve(import.meta.dirname, '../../harmony')
    const manifest = readFileSync(resolve(harmonyRoot, 'entry/src/main/module.json5'), 'utf8')
    const adapter = readFileSync(resolve(harmonyRoot, 'src/compat/expo-camera.tsx'), 'utf8')

    expect(manifest).not.toContain('ohos.permission.CAMERA')
    expect(adapter).toContain('system default scanner is camera-preauthorized')
  })
})
