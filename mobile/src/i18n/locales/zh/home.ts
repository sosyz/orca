const home = {
  mobile: {
    connection: {
      actionsFor: '{{name}} 的操作',
      authFailed: '配对已失效 - 请重新配对桌面端',
      cantConnect: '无法连接',
      cantConnectRelay: '无法通过 Relay 连接',
      cantReach: '无法连接桌面端',
      checkTailscale: '检查 Tailscale',
      connected: '已连接',
      connecting: '正在连接…',
      connectingRelay: '正在通过 Relay 连接…',
      directLan: '直连 · LAN',
      directTailscale: '直连 · Tailscale',
      disconnected: '未连接',
      invalidPairing: '配对已失效',
      openHost: '打开 {{name}}',
      orcaRelay: 'Orca Relay',
      pairingCredentialsUnreadable: '无法读取配对凭据',
      pathSpoken: {
        directLan: '通过 LAN 直连',
        directTailscale: '通过 Tailscale 直连',
        orcaRelay: 'Orca Relay'
      },
      rePairHint: '点按以重新配对桌面端',
      reconnecting: '正在重新连接…',
      retryCredentialsHint: '点按以重试读取已保存的凭据',
      updateRelayHint: '更新桌面端 Orca 并登录，即可随时连接'
    },
    home: {
      accountUsage: '账号用量',
      activeWorktrees: '{{value}} 个活跃',
      alerts: {
        checkPairingFailed: '无法检查配对',
        removeHostFailed: '无法移除主机',
        tryAgain: '请重试。'
      },
      desktopActions: {
        connect: '连接',
        diagnostics: '网络诊断',
        disconnect: '断开连接',
        edit: '编辑主机',
        reconnect: '重新连接',
        remove: '移除'
      },
      desktops: '桌面端',
      empty: {
        body: '与电脑上的 Orca 配对后，就能在手机上查看 Agent、进入任意终端，并继续推进工作。',
        howItWorks: '使用方式',
        pairDesktop: '配对桌面端',
        steps: {
          connected: {
            body: '你的桌面端会显示在这里。所有内容都经过端到端加密。',
            title: '连接完成'
          },
          open: {
            body: '前往“设置 > 移动端”，生成配对二维码。',
            title: '打开 Orca 桌面端'
          },
          scan: {
            body: '点按上方按钮打开扫码器，对准屏幕上的二维码。',
            title: '扫描二维码'
          }
        },
        title: '连接你的桌面端'
      },
      lastKnownWorktrees: '上次已知：{{value}}',
      newWorkspace: '新建工作区',
      pairDesktop: '配对桌面端',
      quickActions: '快捷操作',
      removeHost: {
        confirm: '移除',
        message: '移除“{{name}}”？之后可以重新配对。',
        title: '移除主机'
      },
      resume: '继续',
      stats: {
        agentTime: 'Agent 时长',
        agentsSpawned: '启动的 Agent',
        prsCreated: '创建的 PR'
      },
      systemDefault: '系统默认',
      tasks: {
        noSources: '未连接任务来源',
        openProvider: '打开 {{provider}} 任务',
        title: '任务'
      },
      welcome: '欢迎回来',
      worktreeCount: '{{value}} 个 worktree',
      worktreeCountPlural: '{{value}} 个 worktree',
      worktreeListUnavailable: '无法读取 worktree 列表',
      workspaceHostPickerTitle: '选择新建工作区的主机'
    }
  }
} as const

export default home
