import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, Switch, type ScrollView } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { ReanimatedScrollView } from '../src/components/reanimated-scroll-view'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Smartphone, Type } from 'lucide-react-native'
import { colors, spacing } from '../src/theme/mobile-theme'
import { loadHosts } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import type { RpcClient } from '../src/transport/rpc-client'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import { TerminalShortcutSettings } from '../src/components/TerminalShortcutSettings'
import { useTerminalAutoRestoreFitSettings } from '../src/terminal/use-terminal-auto-restore-fit-settings'
import {
  AUTO_RESTORE_FIT_OPTION_DEFINITIONS,
  autoRestoreSummary,
  valueFromMs,
  type RestoreValue
} from '../src/terminal/terminal-auto-restore-fit-options'
import { terminalSettingsScreenStyles as styles } from '../src/terminal/terminal-settings-screen-styles'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalTextScale,
  saveTerminalAutocompleteEnabled,
  saveTerminalTextScale
} from '../src/storage/preferences'

type TextSizeValue = 'smallest' | 'smaller' | 'default' | 'large' | 'larger' | 'largest'

// scale = baseline zoom the terminal WebView applies on top of fit-to-width.
// Keep in sync with TERMINAL_TEXT_SCALES; pinch-to-zoom snaps to these values.
const TEXT_SIZE_OPTION_DEFINITIONS: readonly {
  value: TextSizeValue
  labelKey: string
  fallback: string
  scale: number
}[] = [
  {
    value: 'smallest',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.smallest',
    fallback: 'Smallest (50%)',
    scale: 0.5
  },
  {
    value: 'smaller',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.smaller',
    fallback: 'Smaller (75%)',
    scale: 0.75
  },
  {
    value: 'default',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.default',
    fallback: 'Default (100%)',
    scale: 1
  },
  {
    value: 'large',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.large',
    fallback: 'Large (125%)',
    scale: 1.25
  },
  {
    value: 'larger',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.larger',
    fallback: 'Larger (150%)',
    scale: 1.5
  },
  {
    value: 'largest',
    labelKey: 'mobile.settings.terminalSettings.textSize.options.largest',
    fallback: 'Largest (200%)',
    scale: 2
  }
]

function textSizeValueFromScale(scale: number): TextSizeValue {
  return TEXT_SIZE_OPTION_DEFINITIONS.find((o) => o.scale === scale)?.value ?? 'default'
}

function textSizeSummary(
  scale: number,
  options: readonly (PickerOption<TextSizeValue> & { scale: number })[]
): string {
  return (options.find((o) => o.scale === scale) ?? options[0]!).label
}

function HostFitRow({
  client,
  hostName,
  summary,
  onPress
}: {
  client: RpcClient | null
  hostName: string
  summary: string
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={!client}
    >
      <Smartphone size={16} color={colors.textSecondary} />
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{hostName}</Text>
        <Text style={styles.rowSublabel}>{summary}</Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}

export default function TerminalSettingsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  useEffect(() => {
    void loadHosts().then(setHosts)
  }, [])
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const { clients: hostClients } = useFocusedSettingsHostClients(hostIds)
  const hostClientsById = useMemo(
    () => new Map(hostClients.map((entry) => [entry.hostId, entry.client])),
    [hostClients]
  )

  // Why: per-host current value, lazily fetched. We keep state at the
  // screen level rather than per-row so the picker can render at root
  // level — embedding PickerModal inside a row clipped its BottomDrawer
  // absoluteFill backdrop to the ScrollView content frame and made the
  // drawer appear cut-off.
  const { hostMs, selectForHost } = useTerminalAutoRestoreFitSettings(hostIds, hostClientsById)
  const [pickerHostId, setPickerHostId] = useState<string | null>(null)

  const [textScale, setTextScale] = useState(1)
  const [textSizePickerOpen, setTextSizePickerOpen] = useState(false)
  const userSelectedTextSizeRef = useRef(false)
  const textSizeOptions = useMemo(
    () =>
      TEXT_SIZE_OPTION_DEFINITIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, option.fallback),
        scale: option.scale
      })),
    [t]
  )
  useEffect(() => {
    let stale = false
    void loadTerminalTextScale().then((scale) => {
      if (!stale && !userSelectedTextSizeRef.current) {
        setTextScale(scale)
      }
    })
    return () => {
      stale = true
    }
  }, [])
  const selectTextSize = useCallback(
    (value: TextSizeValue) => {
      const opt = textSizeOptions.find((o) => o.value === value)
      if (!opt) {
        return
      }
      userSelectedTextSizeRef.current = true
      setTextScale(opt.scale)
      void saveTerminalTextScale(opt.scale)
    },
    [textSizeOptions]
  )

  const autoRestoreFitOptions = useMemo(
    () =>
      AUTO_RESTORE_FIT_OPTION_DEFINITIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, option.fallback),
        ms: option.ms
      })),
    [t]
  )
  const resolveAutoRestoreSummary = useCallback(
    (ms: number | null | undefined) =>
      autoRestoreSummary(
        ms,
        autoRestoreFitOptions,
        t('mobile.settings.terminalSettings.restore.options.afterSeconds', 'After {{seconds}}s', {
          seconds: Math.round((ms ?? 0) / 1000)
        })
      ),
    [autoRestoreFitOptions, t]
  )

  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false)
  // Why: a fast toggle before the initial load resolves must win — otherwise the
  // delayed read would clobber the user's choice with the stored (stale) value.
  const userToggledAutocompleteRef = useRef(false)
  useEffect(() => {
    let stale = false
    void loadTerminalAutocompleteEnabled().then((enabled) => {
      if (!stale && !userToggledAutocompleteRef.current) {
        setAutocompleteEnabled(enabled)
      }
    })
    return () => {
      stale = true
    }
  }, [])
  const toggleAutocomplete = useCallback((next: boolean) => {
    userToggledAutocompleteRef.current = true
    setAutocompleteEnabled(next)
    void saveTerminalAutocompleteEnabled(next)
  }, [])

  function selectValue(hostId: string, value: RestoreValue) {
    const opt = autoRestoreFitOptions.find((o) => o.value === value)
    if (!opt) {
      return
    }
    void selectForHost(hostId, opt.ms)
  }

  const pickerHost = pickerHostId ? hosts.find((h) => h.id === pickerHostId) : null

  const scrollRef = useAnimatedRef<ScrollView>()
  const scrollOffsetY = useSharedValue(0)
  const scrollContentHeight = useSharedValue(0)
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = event.contentOffset.y
  })
  // Why: imperative toggle instead of state — a re-render while a drag gesture
  // is active would rebuild the row gestures and could cancel the drag.
  const setScrollEnabled = useCallback(
    (enabled: boolean) => {
      scrollRef.current?.setNativeProps({ scrollEnabled: enabled })
    },
    [scrollRef]
  )
  const handleDragActiveChange = useCallback(
    (active: boolean) => setScrollEnabled(!active),
    [setScrollEnabled]
  )

  return (
    <GestureHandlerRootView style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>{t('mobile.settings.terminal', 'Terminal')}</Text>
      </View>

      <ReanimatedScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          scrollContentHeight.value = height
        }}
      >
        <Text style={styles.groupHeading}>
          {t('mobile.settings.terminalSettings.restore.heading', 'WHEN YOU LEAVE THE APP')}
        </Text>
        <Text style={styles.groupDescription}>
          {t(
            'mobile.settings.terminalSettings.restore.description',
            "While you're using a terminal on your phone, Orca shrinks it to fit your screen. When you close the app or switch away, this controls whether it stays at phone size (so interactive CLI tools don't reflow) or resizes back to your desktop. You can always use Restore this terminal or Restore all terminals on the banner to resize manually."
          )}
        </Text>

        {hosts.length === 0 ? (
          <View style={[styles.section, styles.sectionTopGap]}>
            <Text style={styles.emptyText}>
              {t(
                'mobile.settings.terminalSettings.restore.empty',
                'No paired desktops yet. Pair one to control terminal behavior.'
              )}
            </Text>
          </View>
        ) : (
          <View style={[styles.section, styles.sectionTopGap]}>
            {hosts.map((host, idx) => {
              const client = hostClientsById.get(host.id) ?? null
              return (
                <View key={host.id}>
                  {idx > 0 && <View style={styles.separator} />}
                  <HostFitRow
                    client={client}
                    hostName={host.name}
                    summary={resolveAutoRestoreSummary(hostMs[host.id])}
                    onPress={() => setPickerHostId(host.id)}
                  />
                </View>
              )
            })}
          </View>
        )}

        <Text style={[styles.groupHeading, styles.inputGroupGap]}>
          {t('mobile.settings.terminalSettings.textSize.heading', 'TEXT SIZE')}
        </Text>
        <Text style={styles.groupDescription}>
          {t(
            'mobile.settings.terminalSettings.textSize.description',
            "Scale the terminal text. Smaller sizes fit more columns with side margins; larger sizes show fewer columns - drag sideways to pan. You can also pinch to zoom in the terminal itself, which updates this setting. Per-device display only; doesn't change the desktop terminal."
          )}
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setTextSizePickerOpen(true)}
          >
            <Type size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {t('mobile.settings.terminalSettings.textSize.rowLabel', 'Text size')}
              </Text>
              <Text style={styles.rowSublabel}>{textSizeSummary(textScale, textSizeOptions)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        <Text style={[styles.groupHeading, styles.inputGroupGap]}>
          {t('mobile.settings.terminalSettings.keyboard.heading', 'KEYBOARD INPUT')}
        </Text>
        <Text style={styles.groupDescription}>
          {t(
            'mobile.settings.terminalSettings.keyboard.description',
            "Enable phone-style autocomplete, autocorrect, and spelling suggestions in the terminal command bar. Off by default so the keyboard never rewrites commands, flags, or paths. Direct keyboard input (when keys go straight to the terminal) always sends raw keystrokes, so suggestions don't apply there."
          )}
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {t(
                  'mobile.settings.terminalSettings.keyboard.autocompleteLabel',
                  'Autocomplete & autocorrect'
                )}
              </Text>
              <Text style={styles.rowSublabel}>
                {autocompleteEnabled
                  ? t('mobile.settings.values.on', 'On')
                  : t('mobile.settings.values.off', 'Off')}
              </Text>
            </View>
            <Switch
              value={autocompleteEnabled}
              onValueChange={toggleAutocomplete}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>

        <TerminalShortcutSettings
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={handleDragActiveChange}
        />
      </ReanimatedScrollView>

      <PickerModal<RestoreValue>
        visible={pickerHost != null}
        title={
          pickerHost
            ? t('mobile.settings.terminalSettings.restore.pickerTitle', 'Restore {{name}}', {
                name: pickerHost.name
              })
            : ''
        }
        options={autoRestoreFitOptions}
        selected={valueFromMs(pickerHost ? hostMs[pickerHost.id] : null)}
        onSelect={(v) => {
          if (pickerHost) {
            void selectValue(pickerHost.id, v)
          }
        }}
        onClose={() => setPickerHostId(null)}
      />

      <PickerModal<TextSizeValue>
        visible={textSizePickerOpen}
        title={t('mobile.settings.terminalSettings.textSize.pickerTitle', 'Terminal text size')}
        options={textSizeOptions}
        selected={textSizeValueFromScale(textScale)}
        onSelect={selectTextSize}
        onClose={() => setTextSizePickerOpen(false)}
      />
    </GestureHandlerRootView>
  )
}
