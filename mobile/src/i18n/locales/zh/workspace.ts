const workspace = {
  mobile: {
    workspace: {
      actions: {
        accounts: '账号',
        advanced: '高级',
        agent: 'Agent',
        closeSearch: '关闭搜索',
        connect: '连接',
        connecting: '正在连接...',
        connectTarget: '连接目标',
        connectTargetFirst: '请先连接目标',
        createWorktree: '创建工作树',
        delete: '删除',
        done: '完成',
        floatingWorkspace: '浮动工作区',
        groupWorkspaces: '工作区分组',
        hideSidebar: '隐藏侧边栏',
        newWorkspace: '新建工作区',
        reconnect: '重新连接',
        searchWorkspaces: '搜索工作区',
        tasks: '任务'
      },
      form: {
        branchName: '分支名称',
        createTitle: '创建工作树',
        derivedFromName: '根据名称生成',
        name: '名称',
        nameOrCreateFrom: "名称或 'Create From'",
        noProjects: '未找到项目',
        note: '备注',
        optional: '可选',
        project: '项目',
        projectPlaceholder: '选择项目',
        reuseBranch: '复用分支“{{branch}}”',
        runOn: '运行位置',
        runTargetPlaceholder: '选择运行目标',
        typeNameOrSearchSource: '输入名称或搜索来源',
        workspaceName: '工作区名称',
        writeNote: '写一条备注'
      },
      host: {
        backToHosts: '返回主机列表',
        fallbackName: '主机',
        removeConfirm: '移除“{{hostName}}”？之后可以重新配对。',
        removeConfirmLabel: '移除',
        removeTitle: '移除主机'
      },
      list: {
        catalogError: {
          detail: 'worktree.ps 失败（{{error}}）— 正在自动重试',
          title: '无法从此主机加载工作区'
        },
        empty: {
          default: '没有工作树',
          filters: '没有符合筛选条件的工作树',
          search: '没有匹配的工作树'
        },
        filter: {
          activeLabel: '筛选 {{count}}',
          activeWorkspacesLabel: '筛选工作区，{{count}} 个已启用',
          clear: '清除筛选',
          hideDefaultBranch: '隐藏默认分支',
          hideSleeping: '隐藏休眠项',
          label: '筛选',
          sectionRepositories: '仓库',
          sectionWorkspaces: '工作区',
          workspacesLabel: '筛选工作区'
        },
        groupLabel: {
          none: '分组',
          prStatus: 'PR',
          repo: '仓库',
          workspaceStatus: '状态'
        },
        groupOptions: {
          none: '不分组',
          prStatus: 'PR 状态',
          repo: '仓库',
          workspaceStatus: '状态'
        },
        groupPickerTitle: '分组方式',
        searchPlaceholder: '搜索工作树...',
        sortByLabel: '按{{label}}排序',
        sortOptions: {
          manual: {
            label: '手动',
            subtitle: '服务器顺序'
          },
          name: {
            label: '名称',
            subtitle: '按名称字母排序'
          },
          recent: {
            label: '最近',
            subtitle: '最近输出优先'
          },
          repo: {
            label: '仓库',
            subtitle: '先按仓库，再按工作区名称'
          },
          smart: {
            label: 'Agent 活动',
            subtitle: '需要关注的 Agent 优先，然后按最近活动'
          }
        },
        sortPickerTitle: '排序方式'
      },
      setup: {
        alwaysTrustAndRun: '始终信任并运行',
        changedTitle: '{{repoName}} 的设置脚本已更改',
        dontRun: '不运行',
        newSetupScript: '新的设置脚本',
        run: '运行',
        runHooks: '运行 hooks',
        runPromptTitle: '运行 {{repoName}} 的设置脚本？',
        runSetupCommand: '运行设置命令',
        setupScript: '设置脚本',
        skip: '跳过',
        subtitle: '此仓库的 orca.yaml 会在工作区启动前运行。只有在信任此仓库时才运行。'
      },
      source: {
        branchMode: '分支',
        createBranchTitle: '创建分支“{{name}}”',
        crossRepoCancel: '取消',
        crossRepoMessage: '此项目属于 {{owner}}/{{repo}}。',
        crossRepoSwitch: '切换到 {{repoName}}',
        emptyHint: {
          branches: '没有匹配的分支。',
          github: '开始输入以搜索 GitHub PR 和 Issue。',
          gitlab: '开始输入以搜索 GitLab MR 和 Issue。',
          jira: '开始输入以搜索 Jira Issue，或粘贴 Issue URL。',
          linear: '开始输入以搜索 Linear Issue。',
          smart: '开始输入以创建名称或查找来源。',
          text: ''
        },
        nameMode: '名称',
        nameThisWorkspace: '将此作为工作区名称',
        needsGitHubRemote: '此 SSH 仓库需要 GitHub remote 才能列出 Issue 和 PR。',
        newBranch: '新分支',
        noResults: '未找到结果。',
        noticeConnectRepo: '连接仓库后即可搜索来源。',
        states: {
          all: '全部',
          closed: '已关闭',
          merged: '已合并',
          opened: '打开'
        },
        title: "名称或 'Create From'",
        typeWorkspaceName: '在下方字段中输入工作区名称。',
        useNameTitle: '使用“{{name}}”'
      },
      ssh: {
        connection: 'SSH 连接',
        status: {
          authFailed: '认证失败',
          connected: '已连接',
          connecting: '正在连接',
          connectionFailed: '连接失败',
          deployingRelay: '正在部署中继',
          disconnected: '未连接',
          reconnectFailed: '重新连接失败',
          reconnecting: '正在重新连接'
        }
      },
      target: {
        hostsConfigured: '已配置 {{count}} 台主机',
        remotePrefix: '远程',
        sshPrefix: 'SSH',
        thisComputer: '这台电脑'
      },
      worktreeActions: {
        deleteMessage: '删除“{{name}}”（{{branch}}）？',
        deleteTitle: '删除工作树',
        pin: '固定',
        sleep: '休眠',
        unpin: '取消固定'
      }
    }
  }
} as const

export default workspace
