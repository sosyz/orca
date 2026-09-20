import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'

type BrowserTranslate = (key: string, options: Record<string, string>) => string

type BrowserKeyCopy = {
  accessibilityLabel: string
  label: string
}

export type MobileBrowserErrorCopy = {
  checkingSupport: string
  commandFailed: string
  dialogFallbackMessage: string
  invalidUrl: string
  pageUnavailable: string
  streamFailed: string
  streamTimedOut: string
  streamUnsupported: string
}

export type MobileBrowserToastCopy = {
  rightClick: string
  sent: string
}

export type MobileBrowserCopy = {
  addressPlaceholder: string
  dialog: {
    cancel: string
    ok: string
    title: string
  }
  errors: MobileBrowserErrorCopy
  keyboard: {
    inputPlaceholder: string
    keys: Record<'Backspace' | 'Enter' | 'Escape' | 'Tab', BrowserKeyCopy>
    sendTextAccessibilityLabel: string
  }
  pointerModifiers: Record<BrowserPointerModifier, BrowserKeyCopy>
  toasts: MobileBrowserToastCopy
  toolbar: {
    back: string
    forward: string
    reload: string
  }
  viewMode: {
    mobile: BrowserKeyCopy
    web: BrowserKeyCopy
  }
}

export function createMobileBrowserCopy(t: BrowserTranslate): MobileBrowserCopy {
  const tr = (key: string, fallback: string, options: Record<string, string> = {}) =>
    t(key, { defaultValue: fallback, ...options })

  const modifierLabel = (modifier: BrowserPointerModifier, fallback: string) =>
    tr(`mobile.browser.pointerModifiers.${modifier}.label`, fallback)

  return {
    addressPlaceholder: tr('mobile.browser.address.placeholder', 'URL'),
    dialog: {
      cancel: tr('mobile.browser.dialog.cancel', 'Cancel'),
      ok: tr('mobile.browser.dialog.ok', 'OK'),
      title: tr('mobile.browser.dialog.title', 'Browser Dialog')
    },
    errors: {
      checkingSupport: tr(
        'mobile.browser.errors.checkingSupport',
        'Checking desktop browser streaming support.'
      ),
      commandFailed: tr('mobile.browser.errors.commandFailed', 'Browser command failed'),
      dialogFallbackMessage: tr('mobile.browser.errors.dialogFallbackMessage', 'Browser dialog'),
      invalidUrl: tr('mobile.browser.errors.invalidUrl', 'Enter a valid URL.'),
      pageUnavailable: tr(
        'mobile.browser.errors.pageUnavailable',
        'Browser page is not available yet.'
      ),
      streamFailed: tr('mobile.browser.errors.streamFailed', 'Browser stream failed.'),
      streamTimedOut: tr('mobile.browser.errors.streamTimedOut', 'Browser stream timed out.'),
      streamUnsupported: tr(
        'mobile.browser.errors.streamUnsupported',
        'Update desktop Orca to stream browser tabs on mobile.'
      )
    },
    keyboard: {
      inputPlaceholder: tr('mobile.browser.keyboard.inputPlaceholder', 'Type on page…'),
      keys: {
        Backspace: {
          accessibilityLabel: tr(
            'mobile.browser.keyboard.keys.backspace.accessibilityLabel',
            'Backspace'
          ),
          label: tr('mobile.browser.keyboard.keys.backspace.label', '⌫')
        },
        Enter: {
          accessibilityLabel: tr('mobile.browser.keyboard.keys.enter.accessibilityLabel', 'Enter'),
          label: tr('mobile.browser.keyboard.keys.enter.label', 'Enter')
        },
        Escape: {
          accessibilityLabel: tr(
            'mobile.browser.keyboard.keys.escape.accessibilityLabel',
            'Escape'
          ),
          label: tr('mobile.browser.keyboard.keys.escape.label', 'Esc')
        },
        Tab: {
          accessibilityLabel: tr('mobile.browser.keyboard.keys.tab.accessibilityLabel', 'Tab'),
          label: tr('mobile.browser.keyboard.keys.tab.label', 'Tab')
        }
      },
      sendTextAccessibilityLabel: tr(
        'mobile.browser.keyboard.sendTextAccessibilityLabel',
        'Send text to browser'
      )
    },
    pointerModifiers: {
      alt: {
        accessibilityLabel: tr(
          'mobile.browser.pointerModifiers.modifierAccessibilityLabel',
          '{{label}} click modifier',
          { label: modifierLabel('alt', 'Alt') }
        ),
        label: modifierLabel('alt', 'Alt')
      },
      cmd: {
        accessibilityLabel: tr(
          'mobile.browser.pointerModifiers.modifierAccessibilityLabel',
          '{{label}} click modifier',
          { label: modifierLabel('cmd', 'Cmd') }
        ),
        label: modifierLabel('cmd', 'Cmd')
      },
      ctrl: {
        accessibilityLabel: tr(
          'mobile.browser.pointerModifiers.modifierAccessibilityLabel',
          '{{label}} click modifier',
          { label: modifierLabel('ctrl', 'Ctrl') }
        ),
        label: modifierLabel('ctrl', 'Ctrl')
      },
      shift: {
        accessibilityLabel: tr(
          'mobile.browser.pointerModifiers.modifierAccessibilityLabel',
          '{{label}} click modifier',
          { label: modifierLabel('shift', 'Shift') }
        ),
        label: modifierLabel('shift', 'Shift')
      }
    },
    toasts: {
      rightClick: tr('mobile.browser.toasts.rightClick', 'Right click'),
      sent: tr('mobile.browser.toasts.sent', 'Sent')
    },
    toolbar: {
      back: tr('mobile.browser.toolbar.back', 'Back'),
      forward: tr('mobile.browser.toolbar.forward', 'Forward'),
      reload: tr('mobile.browser.toolbar.reload', 'Reload')
    },
    viewMode: {
      mobile: {
        accessibilityLabel: tr(
          'mobile.browser.viewMode.mobile.accessibilityLabel',
          'Show mobile website view'
        ),
        label: tr('mobile.browser.viewMode.mobile.label', 'Mobile')
      },
      web: {
        accessibilityLabel: tr(
          'mobile.browser.viewMode.web.accessibilityLabel',
          'Show desktop website view'
        ),
        label: tr('mobile.browser.viewMode.web.label', 'Web')
      }
    }
  }
}
