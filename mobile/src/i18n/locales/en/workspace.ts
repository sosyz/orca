const workspace = {
  mobile: {
    workspace: {
      actions: {
        accounts: 'Accounts',
        advanced: 'Advanced',
        agent: 'Agent',
        closeSearch: 'Close search',
        connect: 'Connect',
        connecting: 'Connecting...',
        connectTarget: 'Connect target',
        connectTargetFirst: 'Connect target first',
        createWorktree: 'Create worktree',
        delete: 'Delete',
        done: 'Done',
        floatingWorkspace: 'Floating Workspace',
        groupWorkspaces: 'Group workspaces',
        hideSidebar: 'Hide sidebar',
        newWorkspace: 'New workspace',
        reconnect: 'Reconnect',
        searchWorkspaces: 'Search workspaces',
        tasks: 'Tasks'
      },
      form: {
        branchName: 'Branch name',
        createTitle: 'Create worktree',
        derivedFromName: 'Derived from name',
        name: 'Name',
        nameOrCreateFrom: "Name or 'Create From'",
        noProjects: 'No projects found',
        note: 'Note',
        optional: 'Optional',
        project: 'Project',
        projectPlaceholder: 'Select a project',
        reuseBranch: 'Reuse branch “{{branch}}”',
        runOn: 'Run on',
        runTargetPlaceholder: 'Select a run target',
        typeNameOrSearchSource: 'Type a name or search a source',
        workspaceName: 'Workspace name',
        writeNote: 'Write a note'
      },
      host: {
        backToHosts: 'Back to hosts',
        fallbackName: 'Host',
        removeConfirm: 'Remove "{{hostName}}"? You can re-pair later.',
        removeConfirmLabel: 'Remove',
        removeTitle: 'Remove Host'
      },
      list: {
        catalogError: {
          detail: 'worktree.ps failed ({{error}}) — retrying automatically',
          title: 'Could not load workspaces from this host'
        },
        empty: {
          default: 'No worktrees',
          filters: 'No worktrees match filters',
          search: 'No matching worktrees'
        },
        filter: {
          activeLabel: 'Filter {{count}}',
          activeWorkspacesLabel: 'Filter workspaces, {{count}} active',
          clear: 'Clear filters',
          hideDefaultBranch: 'Hide default branch',
          hideSleeping: 'Hide sleeping',
          label: 'Filter',
          sectionRepositories: 'Repositories',
          sectionWorkspaces: 'Workspaces',
          workspacesLabel: 'Filter workspaces'
        },
        groupLabel: {
          none: 'Group',
          prStatus: 'PR',
          repo: 'Repo',
          workspaceStatus: 'Status'
        },
        groupOptions: {
          none: 'No Grouping',
          prStatus: 'PR Status',
          repo: 'Repository',
          workspaceStatus: 'Status'
        },
        groupPickerTitle: 'Group By',
        searchPlaceholder: 'Search worktrees...',
        sortByLabel: 'Sort by {{label}}',
        sortOptions: {
          manual: {
            label: 'Manual',
            subtitle: 'Server order'
          },
          name: {
            label: 'Name',
            subtitle: 'Alphabetical by name'
          },
          recent: {
            label: 'Recent',
            subtitle: 'Most recent output first'
          },
          repo: {
            label: 'Repo',
            subtitle: 'Repository, then workspace name'
          },
          smart: {
            label: 'Agent activity',
            subtitle: 'Agents that need attention, then recent activity'
          }
        },
        sortPickerTitle: 'Sort By'
      },
      setup: {
        alwaysTrustAndRun: 'Always trust and run',
        changedTitle: "{{repoName}}'s setup script changed",
        dontRun: "Don't run",
        newSetupScript: 'New setup script',
        run: 'Run',
        runHooks: 'Run hooks',
        runPromptTitle: 'Run setup from {{repoName}}?',
        runSetupCommand: 'Run setup command',
        setupScript: 'Setup script',
        skip: 'Skip',
        subtitle:
          "This repository's orca.yaml runs before the workspace starts. Only run it if you trust this repository."
      },
      source: {
        branchMode: 'Branch',
        createBranchTitle: 'Create branch "{{name}}"',
        crossRepoCancel: 'Cancel',
        crossRepoMessage: 'This item lives in {{owner}}/{{repo}}.',
        crossRepoSwitch: 'Switch to {{repoName}}',
        emptyHint: {
          branches: 'No matching branches.',
          github: 'Start typing to search GitHub PRs and issues.',
          gitlab: 'Start typing to search GitLab MRs and issues.',
          jira: 'Start typing to search Jira issues, or paste an issue URL.',
          linear: 'Start typing to search Linear issues.',
          smart: 'Start typing to create a name or find a source.',
          text: ''
        },
        nameMode: 'Name',
        nameThisWorkspace: 'Name this workspace',
        needsGitHubRemote: 'This SSH repo needs a GitHub remote to list issues and PRs.',
        newBranch: 'New branch',
        noResults: 'No results found.',
        noticeConnectRepo: 'Connect the repository to search sources.',
        states: {
          all: 'All',
          closed: 'Closed',
          merged: 'Merged',
          opened: 'Open'
        },
        title: "Name or 'Create From'",
        typeWorkspaceName: 'Type a workspace name in the field below.',
        useNameTitle: 'Use "{{name}}"'
      },
      ssh: {
        connection: 'SSH Connection',
        status: {
          authFailed: 'Authentication failed',
          connected: 'Connected',
          connecting: 'Connecting',
          connectionFailed: 'Connection failed',
          deployingRelay: 'Deploying relay',
          disconnected: 'Disconnected',
          reconnectFailed: 'Reconnect failed',
          reconnecting: 'Reconnecting'
        }
      },
      target: {
        hostsConfigured: '{{count}} hosts configured',
        remotePrefix: 'Remote',
        sshPrefix: 'SSH',
        thisComputer: 'This computer'
      },
      worktreeActions: {
        deleteMessage: 'Delete "{{name}}" ({{branch}})?',
        deleteTitle: 'Delete Worktree',
        pin: 'Pin',
        sleep: 'Sleep',
        unpin: 'Unpin'
      }
    }
  }
} as const

export default workspace
