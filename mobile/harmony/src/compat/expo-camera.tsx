import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { HarmonyNative, hasHarmonyNativeModule } from '../native/harmony-native-module'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'

type BarcodeEvent = { data: string; type: string }
type CameraViewProps = ComponentProps<typeof View> & {
  barcodeScannerSettings?: { barcodeTypes?: string[] }
  facing?: string
  onBarcodeScanned?: (event: BarcodeEvent) => void
}
const scanKitCameraPermission = {
  canAskAgain: false,
  expires: 'never',
  granted: true,
  status: 'granted'
} as const

export function CameraView({
  barcodeScannerSettings: _barcodeScannerSettings,
  children,
  facing: _facing,
  onBarcodeScanned,
  ...props
}: CameraViewProps) {
  const callbackRef = useRef(onBarcodeScanned)
  const [scanAttempt, setScanAttempt] = useState(0)
  const [scanResult, setScanResult] = useState<'active' | 'cancelled' | 'failed'>('active')
  callbackRef.current = onBarcodeScanned

  useEffect(() => {
    if (!callbackRef.current || !hasHarmonyNativeModule()) {
      return
    }
    let disposed = false
    setScanResult('active')
    void HarmonyNative.scanPairingCode()
      .then((data) => {
        if (disposed) {
          return
        }
        if (data) {
          callbackRef.current?.({ data, type: 'qr' })
          return
        }
        setScanResult('cancelled')
      })
      .catch(() => {
        if (!disposed) {
          setScanResult('failed')
        }
      })
    return () => {
      disposed = true
    }
  }, [scanAttempt])

  return (
    <View {...props}>
      {children}
      {scanResult !== 'active' && (
        <View style={styles.retryOverlay}>
          <Text style={styles.retryMessage}>
            {scanResult === 'cancelled' ? 'Scanner closed' : 'Scanner unavailable'}
          </Text>
          <Pressable
            accessibilityLabel="Scan pairing code again"
            accessibilityRole="button"
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={() => setScanAttempt((attempt) => attempt + 1)}
          >
            <Text style={styles.retryButtonText}>Scan again</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

export function useCameraPermissions() {
  // Scan Kit's system default scanner is camera-preauthorized and owns its privacy UI.
  return [scanKitCameraPermission, async () => scanKitCameraPermission] as const
}

const styles = StyleSheet.create({
  retryOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgPanel
  },
  retryMessage: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  retryButton: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2
  },
  retryButtonPressed: {
    opacity: 0.6
  },
  retryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '600'
  }
})
