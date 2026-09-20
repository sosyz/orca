const browser = {
  mobile: {
    browser: {
      address: {
        placeholder: 'URL'
      },
      dialog: {
        cancel: 'Cancel',
        ok: 'OK',
        title: 'Browser Dialog'
      },
      errors: {
        checkingSupport: 'Checking desktop browser streaming support.',
        commandFailed: 'Browser command failed',
        dialogFallbackMessage: 'Browser dialog',
        invalidUrl: 'Enter a valid URL.',
        pageUnavailable: 'Browser page is not available yet.',
        streamFailed: 'Browser stream failed.',
        streamTimedOut: 'Browser stream timed out.',
        streamUnsupported: 'Update desktop Orca to stream browser tabs on mobile.'
      },
      keyboard: {
        inputPlaceholder: 'Type on page…',
        keys: {
          backspace: {
            accessibilityLabel: 'Backspace',
            label: '⌫'
          },
          enter: {
            accessibilityLabel: 'Enter',
            label: 'Enter'
          },
          escape: {
            accessibilityLabel: 'Escape',
            label: 'Esc'
          },
          tab: {
            accessibilityLabel: 'Tab',
            label: 'Tab'
          }
        },
        sendTextAccessibilityLabel: 'Send text to browser'
      },
      pointerModifiers: {
        alt: {
          label: 'Alt'
        },
        cmd: {
          label: 'Cmd'
        },
        ctrl: {
          label: 'Ctrl'
        },
        modifierAccessibilityLabel: '{{label}} click modifier',
        shift: {
          label: 'Shift'
        }
      },
      toasts: {
        rightClick: 'Right click',
        sent: 'Sent'
      },
      toolbar: {
        back: 'Back',
        forward: 'Forward',
        reload: 'Reload'
      },
      viewMode: {
        mobile: {
          accessibilityLabel: 'Show mobile website view',
          label: 'Mobile'
        },
        web: {
          accessibilityLabel: 'Show desktop website view',
          label: 'Web'
        }
      }
    }
  }
} as const

export default browser
