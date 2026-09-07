import {
  addHarmonyNativeListener,
  HarmonyNative,
  hasHarmonyNativeModule,
  type HarmonyNativeModule
} from '../native/harmony-native-module'

type Subscription = { remove(): void }
type UrlEvent = { url: string }
type SequencedUrlEvent = UrlEvent & { sequence: number }
type UrlListener = (event: UrlEvent) => void
type NativeUrlSubscriber = (listener: (event: unknown) => void) => Subscription

const MAX_EXTERNAL_URL_LENGTH = 8192
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const SAFE_EXTERNAL_URL_PATTERN = /^(https?):\/\/([^/?#\s]+)(?:[/?#].*)?$/i

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true
    }
  }
  return false
}

function parseUrlEvent(value: unknown): SequencedUrlEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { sequence?: unknown; url?: unknown }
  return Number.isSafeInteger(candidate.sequence) &&
    Number(candidate.sequence) > 0 &&
    typeof candidate.url === 'string' &&
    candidate.url.length > 0
    ? { sequence: Number(candidate.sequence), url: candidate.url }
    : null
}

function safeExternalUrl(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_EXTERNAL_URL_LENGTH ||
    hasAsciiControlCharacter(trimmed) ||
    trimmed.includes('\\')
  ) {
    throw new Error('Unsupported external URL')
  }
  const authorityMatch = SAFE_EXTERNAL_URL_PATTERN.exec(trimmed)
  if (!authorityMatch || authorityMatch[2].includes('@')) {
    throw new Error('Unsupported external URL')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Unsupported external URL')
  }
  if (
    !SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error('Unsupported external URL')
  }
  return trimmed
}

export function createHarmonyLinkingAdapter(
  native: Pick<
    HarmonyNativeModule,
    'getLatestUrlEvent' | 'openApplicationSettings' | 'openExternalUrl'
  >,
  subscribe: NativeUrlSubscriber
) {
  const listeners = new Set<UrlListener>()
  let lastSequence = 0
  let nativeSubscription: Subscription | null = null

  const deliver = (value: unknown) => {
    const event = parseUrlEvent(value)
    if (!event || event.sequence <= lastSequence) {
      return
    }
    lastSequence = event.sequence
    for (const listener of listeners) {
      listener({ url: event.url })
    }
  }

  return {
    addEventListener(eventType: 'url', listener: UrlListener): Subscription {
      if (eventType !== 'url') {
        throw new Error(`Unsupported linking event: ${eventType as string}`)
      }
      listeners.add(listener)
      if (!nativeSubscription) {
        nativeSubscription = subscribe(deliver)
      }
      deliver(native.getLatestUrlEvent())
      let active = true
      return {
        remove() {
          if (!active) {
            return
          }
          active = false
          listeners.delete(listener)
          if (listeners.size === 0) {
            nativeSubscription?.remove()
            nativeSubscription = null
          }
        }
      }
    },
    async getInitialURL(): Promise<string | null> {
      const event = parseUrlEvent(native.getLatestUrlEvent())
      if (!event || event.sequence <= lastSequence) {
        return null
      }
      lastSequence = event.sequence
      return event.url
    },
    openSettings(): Promise<void> {
      return native.openApplicationSettings()
    },
    async openURL(value: string): Promise<void> {
      return native.openExternalUrl(safeExternalUrl(value))
    }
  }
}

const adapter = createHarmonyLinkingAdapter(HarmonyNative, (listener) =>
  addHarmonyNativeListener('OrcaHarmonyUrl', listener)
)

export function addEventListener(eventType: 'url', listener: UrlListener): Subscription {
  if (!hasHarmonyNativeModule()) {
    return { remove() {} }
  }
  return adapter.addEventListener(eventType, listener)
}

export function getInitialURL(): Promise<string | null> {
  return hasHarmonyNativeModule() ? adapter.getInitialURL() : Promise.resolve(null)
}

export const { openSettings, openURL } = adapter
