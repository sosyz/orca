const session = {
  mobile: {
    session: {
      diff: {
        lineLabel: '{{title}} 差异第 {{line}} 行'
      },
      file: {
        imageLabel: '{{title}} 图片',
        previewLabel: '{{title}} 预览'
      },
      markdown: {
        actions: {
          copy: '复制',
          discard: '放弃',
          refresh: '刷新'
        },
        changedOnDesktop: '桌面端已更改',
        dismissKeyboard: {
          hint: '隐藏软键盘，并保持 Markdown 编辑器打开。',
          label: '收起键盘'
        },
        readOnly: '只读'
      },
      reviewNotes: {
        addLineLabel: '在第 {{line}} 行添加备注',
        composerPlaceholder: '添加审阅备注',
        copy: '复制',
        copyLabel: '复制审阅备注',
        deleteLineLabel: '删除第 {{line}} 行的备注',
        empty: '暂无审阅备注',
        lineMeta: '第 {{line}} 行',
        save: '保存备注',
        send: '发送',
        sendLabel: '将审阅备注发送给 AI',
        summaryOne: '{{count}} 条审阅备注',
        summaryMany: '{{count}} 条审阅备注'
      },
      quickCommands: {
        actions: {
          add: '添加快捷命令',
          cancel: '取消',
          chooseAgent: '选择 Agent',
          copy: '复制 {{label}}',
          couldNotCopy: '无法复制',
          delete: '删除 {{label}}',
          edit: '编辑 {{label}}',
          nothingToCopy: '没有可复制内容',
          run: '运行 {{label}}',
          save: '保存'
        },
        deleteConfirm: {
          message: '这个快捷命令会从已保存列表中移除。',
          title: '删除“{{label}}”？'
        },
        editor: {
          action: '动作',
          advanced: '高级',
          agent: 'Agent',
          agentPrompt: 'Agent 提示词',
          appendEnter: '追加回车',
          appendEnterHint: '立即提交，而不是只插入文本。',
          commandText: '命令文本',
          desc: '保存终端命令或 Agent 提示词，方便快速使用。',
          hint: '支持技能、文件路径和内置命令。',
          label: '标签',
          prompt: '提示词',
          scope: '范围',
          terminalCommand: '终端命令'
        },
        groups: {
          global: '全局',
          project: '当前项目'
        },
        placeholders: {
          command: 'npm run dev',
          label: '启动开发服务器',
          prompt: '让 Agent 检查这个工作区',
          search: '搜索快捷命令...'
        },
        states: {
          copied: '已复制',
          empty: '还没有快捷命令。',
          limitReached: '快捷命令数量已达上限',
          noMatches: '没有匹配的快捷命令。',
          newCommand: '新建快捷命令',
          project: '项目',
          untitled: '未命名'
        },
        titles: {
          add: '添加快捷命令',
          agent: '选择 Agent',
          edit: '编辑快捷命令',
          list: '快捷命令'
        }
      },
      shell: {
        actions: {
          addCustomShortcut: '添加自定义快捷键',
          backToWorktrees: '返回 worktree 列表',
          copyAllAndLeave: '全部复制并离开',
          copyNotes: '复制备注',
          copyPath: '复制路径',
          createTab: '创建标签页',
          discard: '放弃',
          discardAndLeave: '放弃并离开',
          discardAndClose: '放弃并关闭',
          dismissKeyboard: '收起键盘',
          dismissWorkspaceCreationWarning: '关闭工作区创建警告',
          moreSessionActions: '更多会话操作',
          newTab: '新建标签页',
          open: '打开',
          openFileExplorer: '打开文件浏览器',
          openSourceControl: '打开源码管理',
          pasteFromClipboard: '从剪贴板粘贴',
          reconnectToDesktop: '重新连接桌面端',
          refresh: '刷新',
          remove: '移除',
          retry: '重试',
          retryLoadingTerminal: '重试加载终端',
          sendCommand: '发送命令'
        },
        agentMenu: {
          agentHistory: 'Agent 历史',
          agentHistoryHint: '浏览并恢复 Agent 会话',
          checks: '检查',
          checksHint: '打开拉取请求检查',
          copyNotesInstead: '改为复制备注',
          detectingAgents: '正在检测 Agent',
          newAgentSession: '新建 Agent 会话',
          noEnabledAgents: '没有已启用的 Agent',
          presetsUnavailable: 'Agent 预设不可用',
          checkHostConnection: '检查主机连接'
        },
        browserActions: {
          back: '后退',
          close: '关闭',
          forward: '前进',
          reload: '重新加载'
        },
        bulkClose: {
          close: '关闭',
          closeOtherTabs: '关闭其他标签页',
          closeTabsToLeft: '关闭左侧标签页'
        },
        empty: {
          creating: '正在创建...',
          loadingTerminal: '正在加载终端',
          noTabs: '这个会话中没有标签页',
          terminalTakingLong: '终端加载时间比预期更长'
        },
        modals: {
          deleteShortcutMessage: '移除这个自定义快捷键？',
          discardMarkdownMessage: '用最新桌面端文件替换手机草稿？',
          discardMarkdownAndCloseMessage: '放弃手机草稿并关闭此标签页？',
          discardMarkdownTitle: '放弃更改',
          newBrowserMessage: '输入 URL，或留空打开新标签页。',
          newBrowserPlaceholder: 'https://example.com',
          newBrowserTitle: '新建浏览器',
          renameTerminalPlaceholder: '终端名称',
          renameTerminalTitle: '重命名终端',
          unsavedMarkdownMessage: '离开前复制或放弃手机草稿。',
          unsavedMarkdownTitle: '未保存的 Markdown 更改'
        },
        placeholders: {
          terminalCommand: '输入命令...'
        },
        tabActions: {
          browser: '浏览器',
          file: '文件',
          markdown: 'Markdown',
          markdownNote: 'Markdown 笔记',
          newTabTitle: '新建标签页',
          quickCommands: '快捷命令',
          shortcut: '快捷键',
          terminal: '终端'
        },
        terminalActions: {
          clear: '清空终端',
          rename: '重命名',
          sendKey: '发送 {{label}}',
          switchToBufferedInput: '切换到缓冲命令输入',
          switchToDesktop: '切换到桌面模式',
          switchToDesktopMode: '切换到桌面模式',
          switchToLiveInput: '切换到实时终端输入',
          switchToPhone: '切换到手机模式',
          switchToPhoneMode: '切换到手机模式'
        },
        toasts: {
          browserCommandFailed: '浏览器命令失败',
          browserPageUnavailable: '浏览器页面暂时不可用。',
          browserUpdateRequired: '需要更新桌面端才能在移动端串流浏览器',
          copied: '已复制',
          couldNotClearTerminal: '无法清空终端',
          couldNotCopy: '无法复制',
          couldNotCopyDrafts: '无法复制草稿',
          couldNotCopyNotes: '无法复制备注',
          couldNotCopyPath: '无法复制路径',
          couldNotRunQuickCommand: '无法运行 {{label}}',
          couldNotSendNotes: '无法发送备注',
          desktopUpdateRequiredQuickCommands: '需要更新桌面端才能使用快捷命令',
          dictationInserted: '已插入听写内容',
          editQuickCommandBeforeRunning: '运行前请先编辑这个快捷命令',
          failedToCreateBrowser: '无法创建浏览器',
          failedToCreateMarkdown: '无法创建 Markdown 笔记',
          failedToCreateTerminal: '无法创建终端',
          failedToDeleteNote: '无法删除备注',
          failedToSaveNote: '无法保存备注',
          failedToSendNotes: '无法发送备注',
          inputTooLarge: '输入过大（最大 256 KiB）',
          invalidUrl: '请输入有效的 URL',
          notesCopied: '备注已复制',
          notesSent: '备注已发送',
          noteAdded: '备注已添加',
          openHostToWakeAgents: '在主机上打开 Orca 以唤醒休眠的 Agent。',
          pathCopied: '路径已复制',
          quickCommandsChecking: '正在检查桌面端能力 - 请稍后重试',
          saved: '已保存',
          saveFailed: '保存失败',
          selectionCleared: '选择已清除（已滚出缓冲区）',
          terminalCleared: '终端已清空',
          terminalInputLocked: '终端输入被另一个客户端锁定。',
          waitingForDesktop: '正在等待桌面端...'
        }
      },
      terminalInput: {
        attach: {
          fileHint: '长按可改为附加文件',
          photoLabel: '附加照片',
          sendingImageLabel: '正在发送图片'
        },
        dictation: {
          cancel: '取消语音听写',
          start: '开始语音听写',
          starting: '正在启动语音听写',
          stop: '停止语音听写'
        },
        focus: {
          hint: '输入的文字会直接发送到当前终端',
          label: '显示实时终端输入键盘'
        },
        status: {
          liveDetail: '点按显示键盘',
          liveTitle: '实时输入',
          processingDetail: '正在桌面端转写',
          processingTitle: '正在处理',
          recordingDetail: '点按麦克风停止',
          recordingTitle: '正在聆听',
          startingDetail: '正在准备麦克风',
          startingTitle: '正在启动麦克风',
          uploadingImageDetail: '正在上传图片到主机'
        }
      }
    }
  }
} as const

export default session
