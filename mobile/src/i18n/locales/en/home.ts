const home = {
  mobile: {
    connection: {
      actionsFor: 'Actions for {{name}}',
      authFailed: 'Pairing invalid - re-pair with your desktop',
      cantConnect: "Can't connect",
      cantConnectRelay: "Can't connect via Relay",
      cantReach: "Can't reach desktop",
      checkTailscale: 'check Tailscale',
      connected: 'Connected',
      connecting: 'Connecting…',
      connectingRelay: 'Connecting via Relay…',
      directLan: 'Direct · LAN',
      directTailscale: 'Direct · Tailscale',
      disconnected: 'Disconnected',
      invalidPairing: 'Pairing invalid',
      openHost: 'Open {{name}}',
      orcaRelay: 'Orca Relay',
      pairingCredentialsUnreadable: "Pairing credentials couldn't be read",
      pathSpoken: {
        directLan: 'Direct via LAN',
        directTailscale: 'Direct via Tailscale',
        orcaRelay: 'Orca Relay'
      },
      rePairHint: 'Tap to re-pair with your desktop',
      reconnecting: 'Reconnecting…',
      retryCredentialsHint: 'Tap to retry reading saved credentials',
      updateRelayHint: 'Update desktop Orca and sign in to connect from anywhere'
    },
    home: {
      accountUsage: 'Account usage',
      activeWorktrees: '{{value}} active',
      alerts: {
        checkPairingFailed: 'Could not check pairing',
        removeHostFailed: 'Could not remove host',
        tryAgain: 'Please try again.'
      },
      desktopActions: {
        connect: 'Connect',
        diagnostics: 'Network diagnostics',
        disconnect: 'Disconnect',
        edit: 'Edit host',
        reconnect: 'Reconnect',
        remove: 'Remove'
      },
      desktops: 'Desktops',
      empty: {
        body: 'Pair with Orca on your computer to check on your agents, jump into any terminal, and drive work from your phone.',
        howItWorks: 'How it works',
        pairDesktop: 'Pair Desktop',
        steps: {
          connected: {
            body: 'Your desktop will appear here. Everything is encrypted end-to-end.',
            title: "You're connected"
          },
          open: {
            body: 'Go to Settings > Mobile and generate a pairing QR code.',
            title: 'Open Orca desktop'
          },
          scan: {
            body: 'Tap the button above to open the scanner. Point at the QR code on your screen.',
            title: 'Scan the code'
          }
        },
        title: 'Connect your desktop'
      },
      lastKnownWorktrees: 'Last known: {{value}}',
      newWorkspace: 'New Workspace',
      pairDesktop: 'Pair Desktop',
      quickActions: 'Quick Actions',
      removeHost: {
        confirm: 'Remove',
        message: 'Remove "{{name}}"? You can re-pair later.',
        title: 'Remove Host'
      },
      resume: 'Resume',
      stats: {
        agentTime: 'Agent time',
        agentsSpawned: 'Agents spawned',
        prsCreated: 'PRs created'
      },
      systemDefault: 'System default',
      tasks: {
        noSources: 'No task sources connected',
        openProvider: 'Open {{provider}} tasks',
        title: 'Tasks'
      },
      welcome: 'Welcome back',
      worktreeCount: '{{value}} worktree',
      worktreeCountPlural: '{{value}} worktrees',
      worktreeListUnavailable: 'Worktree list unavailable',
      workspaceHostPickerTitle: 'Create Workspace On'
    }
  }
} as const

export default home
