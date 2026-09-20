const settings = {
  settings: {
    appearance: {
      language: {
        chinese: 'Simplified Chinese',
        english: 'English',
        system: 'System'
      }
    }
  },
  mobile: {
    settings: {
      browser: 'Browser',
      browserSettings: {
        links: {
          description: 'Choose where HTTP(S) links tapped in terminal output open.',
          heading: 'LINKS',
          options: {
            orcaBrowser: {
              label: 'Orca browser on desktop',
              subtitle: 'Open in the streamed browser from your paired desktop.'
            },
            phoneBrowser: {
              label: 'Phone browser',
              subtitle: 'Open in Safari, Chrome, or another browser on this phone.'
            }
          },
          pickerTitle: 'Open terminal links',
          rowLabel: 'Open terminal links'
        }
      },
      chatUi: 'Chat UI',
      credentialCleanup: {
        retryA11y: 'Retry clearing pairing credentials',
        stillFailed: "Cleanup still couldn't be confirmed. Try again later.",
        title: 'Pairing credential cleanup',
        unreadable: "Couldn't check cleanup status on this device. Retry to be safe.",
        unconfirmed: "Couldn't confirm cleanup for {{value}} credential on this device.",
        unconfirmedPlural: "Couldn't confirm cleanup for {{value}} credentials on this device."
      },
      language: {
        followsDevice: 'Follows this device',
        pickerTitle: 'Language',
        readFailed: 'Language preference could not be loaded. Using system language.',
        systemValue: 'System ({{locale}})',
        title: 'Language',
        writeFailed: 'Language preference could not be saved. This change may reset after restart.'
      },
      nativeChat: {
        defaultView: {
          description:
            'Choose how supported agent sessions (Claude, Codex, and other chat-capable agents) open on this device. Terminal shows the raw CLI; Chat UI shows a chat interface like the desktop app. You can still switch any individual session from its long-press menu.',
          heading: 'DEFAULT VIEW',
          openInChat: 'Open sessions in Chat UI'
        }
      },
      notifications: 'Notifications',
      privacyPolicy: 'Privacy Policy',
      support: 'Support',
      terminal: 'Terminal',
      terminalSettings: {
        customShortcuts: {
          add: 'Add Custom Shortcut...',
          addDescription: 'Create key combo or text macro',
          deleteLabel: 'Delete {{label}} shortcut',
          empty: 'No custom shortcuts defined yet.',
          heading: 'CUSTOM SHORTCUTS',
          modal: {
            add: 'Add',
            addShortcut: 'Add Shortcut',
            addTitle: 'Add Shortcut',
            command: 'Command',
            commandPlaceholder: 'e.g. pnpm build',
            key: 'Key',
            label: 'Label',
            labelPlaceholder: 'e.g. Build',
            manageShortcuts: 'Manage Shortcuts',
            manageShortcutsDescription: 'Show, hide, or reorder shortcut keys',
            modifiers: 'Modifiers',
            moreKeys: 'More keys - Tab, arrows, F1-F12...',
            pickKeyTitle: 'Pick a key',
            pressEnter: 'Press Enter',
            shortcutComboDescription: 'Build Ctrl, Alt, and Shift key chords',
            shortcutComboTitle: 'Shortcut Combo',
            specialGroups: {
              editing: 'Editing',
              function: 'Function',
              navigation: 'Navigation'
            },
            textMacroDescription: 'Send custom text command',
            textMacroTitle: 'Text Macro'
          }
        },
        keyboard: {
          autocompleteLabel: 'Autocomplete & autocorrect',
          description:
            "Enable phone-style autocomplete, autocorrect, and spelling suggestions in the terminal command bar. Off by default so the keyboard never rewrites commands, flags, or paths. Direct keyboard input (when keys go straight to the terminal) always sends raw keystrokes, so suggestions don't apply there.",
          heading: 'KEYBOARD INPUT'
        },
        restore: {
          description:
            "While you're using a terminal on your phone, Orca shrinks it to fit your screen. When you close the app or switch away, this controls whether it stays at phone size (so interactive CLI tools don't reflow) or resizes back to your desktop. You can always use Restore this terminal or Restore all terminals on the banner to resize manually.",
          empty: 'No paired desktops yet. Pair one to control terminal behavior.',
          heading: 'WHEN YOU LEAVE THE APP',
          options: {
            afterFiveMinutes: 'After 5 minutes',
            afterOneMinute: 'After 1 minute',
            afterSeconds: 'After {{seconds}}s',
            afterThirtyMinutes: 'After 30 minutes',
            indefinite: 'Keep at phone size (default)'
          },
          pickerTitle: 'Restore {{name}}'
        },
        shortcuts: {
          description: 'Toggle keys to show or hide them, and {{orderAction}} to set their order.',
          heading: 'SHORTCUT BAR',
          orderActionDrag: 'drag the grip',
          orderActionHarmony: 'use up/down controls',
          resetDefaults: 'Reset Defaults',
          resetDefaultsDescription: 'Show every built-in shortcut key in the original order'
        },
        textSize: {
          description:
            "Scale the terminal text. Smaller sizes fit more columns with side margins; larger sizes show fewer columns - drag sideways to pan. You can also pinch to zoom in the terminal itself, which updates this setting. Per-device display only; doesn't change the desktop terminal.",
          heading: 'TEXT SIZE',
          options: {
            default: 'Default (100%)',
            large: 'Large (125%)',
            larger: 'Larger (150%)',
            largest: 'Largest (200%)',
            smaller: 'Smaller (75%)',
            smallest: 'Smallest (50%)'
          },
          pickerTitle: 'Terminal text size',
          rowLabel: 'Text size'
        }
      },
      title: 'Settings',
      troubleshooting: 'Troubleshooting',
      values: {
        off: 'Off',
        on: 'On'
      },
      voice: 'Voice'
    }
  }
} as const

export default settings
