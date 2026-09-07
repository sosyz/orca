import type { Want } from '@kit.AbilityKit';

// Keep this in sync with src/shared/mobile-pairing-protocol-limits.ts.
const PAIRING_INPUT_MAX_CHARACTERS = 129 * 1024;
const ORCA_LINK_PATTERN = /^orca:\/\/([^\/?#]*)([^?#]*)?/i;

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function isSupportedOrcaLink(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > PAIRING_INPUT_MAX_CHARACTERS ||
    hasAsciiControlCharacter(value)
  ) {
    return false;
  }
  const match = ORCA_LINK_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const host = match[1]?.toLowerCase();
  const pathname = match[2] ?? '';
  return host === 'pair' && (pathname.length === 0 || pathname === '/');
}

export interface HarmonyUrlEvent {
  sequence: number;
  url: string;
}

export class HarmonyLinkingState {
  private static latestEvent: HarmonyUrlEvent | null = null;
  private static listener: ((event: HarmonyUrlEvent) => void) | null = null;
  private static listenerToken = 0;
  private static sequence = 0;

  static attach(listener: (event: HarmonyUrlEvent) => void): number {
    const token = HarmonyLinkingState.listenerToken + 1;
    HarmonyLinkingState.listenerToken = token;
    HarmonyLinkingState.listener = listener;
    return token;
  }

  static detach(token: number): void {
    if (token !== HarmonyLinkingState.listenerToken) {
      return;
    }
    HarmonyLinkingState.listener = null;
  }

  static getLatest(): HarmonyUrlEvent | null {
    const event = HarmonyLinkingState.latestEvent;
    return event ? { sequence: event.sequence, url: event.url } : null;
  }

  static receiveInitialWant(want: Want): void {
    HarmonyLinkingState.receiveWant(want, false);
  }

  static receiveNewWant(want: Want): void {
    HarmonyLinkingState.receiveWant(want, true);
  }

  private static receiveWant(want: Want, emit: boolean): void {
    const value = want.uri;
    if (typeof value !== 'string' || !isSupportedOrcaLink(value.trim())) {
      return;
    }
    const event: HarmonyUrlEvent = {
      sequence: HarmonyLinkingState.sequence + 1,
      url: value,
    };
    HarmonyLinkingState.sequence = event.sequence;
    HarmonyLinkingState.latestEvent = event;
    if (emit) {
      HarmonyLinkingState.listener?.(event);
    }
  }
}
