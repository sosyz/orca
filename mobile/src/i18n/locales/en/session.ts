const session = {
  mobile: {
    session: {
      diff: {
        lineLabel: '{{title}} diff line {{line}}'
      },
      file: {
        imageLabel: '{{title}} image',
        previewLabel: '{{title}} preview'
      },
      markdown: {
        actions: {
          copy: 'Copy',
          discard: 'Discard',
          refresh: 'Refresh'
        },
        changedOnDesktop: 'Changed on desktop',
        dismissKeyboard: {
          hint: 'Hides the software keyboard and keeps the markdown editor open.',
          label: 'Dismiss keyboard'
        },
        readOnly: 'Read only'
      },
      reviewNotes: {
        addLineLabel: 'Add note on line {{line}}',
        composerPlaceholder: 'Add review note',
        copy: 'Copy',
        copyLabel: 'Copy review notes',
        deleteLineLabel: 'Delete note on line {{line}}',
        empty: 'No review notes',
        lineMeta: 'Line {{line}}',
        save: 'Save note',
        send: 'Send',
        sendLabel: 'Send review notes to AI',
        summaryOne: '{{count}} review note',
        summaryMany: '{{count}} review notes'
      },
      quickCommands: {
        actions: {
          add: 'Add Quick Command',
          cancel: 'Cancel',
          chooseAgent: 'Choose agent',
          copy: 'Copy {{label}}',
          couldNotCopy: "Couldn't copy",
          delete: 'Delete {{label}}',
          edit: 'Edit {{label}}',
          nothingToCopy: 'Nothing to copy',
          run: 'Run {{label}}',
          save: 'Save'
        },
        deleteConfirm: {
          message: 'This quick command will be removed from your saved list.',
          title: 'Delete "{{label}}"?'
        },
        editor: {
          action: 'Action',
          advanced: 'Advanced',
          agent: 'Agent',
          agentPrompt: 'Agent Prompt',
          appendEnter: 'Append Enter',
          appendEnterHint: 'Submit immediately instead of only inserting text.',
          commandText: 'Command Text',
          desc: 'Save terminal commands or agent prompts for quick access.',
          hint: 'Supports skills, file paths, and built-in commands.',
          label: 'Label',
          prompt: 'Prompt',
          scope: 'Scope',
          terminalCommand: 'Terminal Command'
        },
        groups: {
          global: 'Global',
          project: 'This project'
        },
        placeholders: {
          command: 'npm run dev',
          label: 'Start dev server',
          prompt: 'Ask the agent to investigate this workspace',
          search: 'Search quick commands...'
        },
        states: {
          copied: 'Copied',
          empty: 'No quick commands yet.',
          limitReached: 'Quick command limit reached',
          noMatches: 'No matching quick commands.',
          newCommand: 'New quick command',
          project: 'Project',
          untitled: 'Untitled'
        },
        titles: {
          add: 'Add Quick Command',
          agent: 'Choose Agent',
          edit: 'Edit Quick Command',
          list: 'Quick Commands'
        }
      },
      shell: {
        actions: {
          addCustomShortcut: 'Add custom shortcut',
          backToWorktrees: 'Back to worktrees',
          copyAllAndLeave: 'Copy All & Leave',
          copyNotes: 'Copy Notes',
          copyPath: 'Copy Path',
          createTab: 'Create Tab',
          discard: 'Discard',
          discardAndLeave: 'Discard & Leave',
          discardAndClose: 'Discard & Close',
          dismissKeyboard: 'Dismiss keyboard',
          dismissWorkspaceCreationWarning: 'Dismiss workspace creation warning',
          moreSessionActions: 'More session actions',
          newTab: 'New tab',
          open: 'Open',
          openFileExplorer: 'Open file explorer',
          openSourceControl: 'Open source control',
          pasteFromClipboard: 'Paste from clipboard',
          reconnectToDesktop: 'Reconnect to desktop',
          refresh: 'Refresh',
          remove: 'Remove',
          retry: 'Retry',
          retryLoadingTerminal: 'Retry loading terminal',
          sendCommand: 'Send command'
        },
        agentMenu: {
          agentHistory: 'Agent History',
          agentHistoryHint: 'Browse and resume agent sessions',
          checks: 'Checks',
          checksHint: 'Open pull request checks',
          copyNotesInstead: 'Copy notes instead',
          detectingAgents: 'Detecting Agents',
          newAgentSession: 'New agent session',
          noEnabledAgents: 'No Enabled Agents',
          presetsUnavailable: 'Agent Presets Unavailable',
          checkHostConnection: 'Check the host connection'
        },
        browserActions: {
          back: 'Back',
          close: 'Close',
          forward: 'Forward',
          reload: 'Reload'
        },
        bulkClose: {
          close: 'Close',
          closeOtherTabs: 'Close Other Tabs',
          closeTabsToLeft: 'Close Tabs to the Left'
        },
        empty: {
          creating: 'Creating...',
          loadingTerminal: 'Loading terminal',
          noTabs: 'No tabs in this session',
          terminalTakingLong: 'Terminal is taking longer than expected'
        },
        modals: {
          deleteShortcutMessage: 'Remove this custom shortcut?',
          discardMarkdownMessage: 'Replace the phone draft with the latest desktop file?',
          discardMarkdownAndCloseMessage: 'Discard the phone draft and close this tab?',
          discardMarkdownTitle: 'Discard Changes',
          newBrowserMessage: 'Enter a URL, or leave blank for a new tab.',
          newBrowserPlaceholder: 'https://example.com',
          newBrowserTitle: 'New Browser',
          renameTerminalPlaceholder: 'Terminal name',
          renameTerminalTitle: 'Rename Terminal',
          unsavedMarkdownMessage: 'Copy or discard phone drafts before leaving.',
          unsavedMarkdownTitle: 'Unsaved markdown changes'
        },
        placeholders: {
          terminalCommand: 'Type a command…'
        },
        tabActions: {
          browser: 'Browser',
          file: 'File',
          markdown: 'Markdown',
          markdownNote: 'Markdown Note',
          newTabTitle: 'New Tab',
          quickCommands: 'Quick commands',
          shortcut: 'Shortcut',
          terminal: 'Terminal'
        },
        terminalActions: {
          clear: 'Clear Terminal',
          rename: 'Rename',
          sendKey: 'Send {{label}}',
          switchToBufferedInput: 'Switch to buffered command input',
          switchToDesktop: 'Switch to Desktop',
          switchToDesktopMode: 'Switch to desktop mode',
          switchToLiveInput: 'Switch to live terminal input',
          switchToPhone: 'Switch to Phone',
          switchToPhoneMode: 'Switch to phone mode'
        },
        toasts: {
          browserCommandFailed: 'Browser command failed',
          browserPageUnavailable: 'Browser page is not available yet.',
          browserUpdateRequired: 'Desktop update required for mobile browser streaming',
          copied: 'Copied',
          couldNotClearTerminal: "Couldn't clear terminal",
          couldNotCopy: "Couldn't copy",
          couldNotCopyDrafts: "Couldn't copy drafts",
          couldNotCopyNotes: "Couldn't copy notes",
          couldNotCopyPath: "Couldn't copy path",
          couldNotRunQuickCommand: "Couldn't run {{label}}",
          couldNotSendNotes: "Couldn't send notes",
          desktopUpdateRequiredQuickCommands: 'Desktop update required for quick commands',
          dictationInserted: 'Dictation inserted',
          editQuickCommandBeforeRunning: 'Edit this quick command before running it',
          failedToCreateBrowser: 'Failed to create browser',
          failedToCreateMarkdown: 'Failed to create markdown note',
          failedToCreateTerminal: 'Failed to create terminal',
          failedToDeleteNote: 'Failed to delete note',
          failedToSaveNote: 'Failed to save note',
          failedToSendNotes: 'Failed to send notes',
          inputTooLarge: 'Input too large (max 256 KiB)',
          invalidUrl: 'Enter a valid URL',
          notesCopied: 'Notes copied',
          notesSent: 'Notes sent',
          noteAdded: 'Note added',
          openHostToWakeAgents: 'Open Orca on the host to wake sleeping agents.',
          pathCopied: 'Path copied',
          quickCommandsChecking: 'Checking desktop capabilities - try again in a moment',
          saved: 'Saved',
          saveFailed: 'Save failed',
          selectionCleared: 'Selection cleared (scrolled out of buffer)',
          terminalCleared: 'Terminal cleared',
          terminalInputLocked: 'Terminal input is locked by another client.',
          waitingForDesktop: 'Waiting for desktop...'
        }
      },
      terminalInput: {
        attach: {
          fileHint: 'Long press to attach a file instead',
          photoLabel: 'Attach a photo',
          sendingImageLabel: 'Sending image'
        },
        dictation: {
          cancel: 'Cancel voice dictation',
          start: 'Start voice dictation',
          starting: 'Starting voice dictation',
          stop: 'Stop voice dictation'
        },
        focus: {
          hint: 'Typed text is sent directly to the active terminal',
          label: 'Show keyboard for live terminal input'
        },
        status: {
          liveDetail: 'Tap to show keyboard',
          liveTitle: 'Live input',
          processingDetail: 'Transcribing on desktop',
          processingTitle: 'Processing',
          recordingDetail: 'Tap mic to stop',
          recordingTitle: 'Listening',
          startingDetail: 'Preparing microphone',
          startingTitle: 'Starting mic',
          uploadingImageDetail: 'Uploading image to host'
        }
      }
    }
  }
} as const

export default session
