const settings = {
  settings: {
    appearance: {
      language: {
        chinese: '简体中文',
        english: '英语',
        system: '跟随系统'
      }
    }
  },
  mobile: {
    settings: {
      browser: '浏览器',
      browserSettings: {
        links: {
          description: '选择在终端输出中点按 HTTP(S) 链接时打开的位置。',
          heading: '链接',
          options: {
            orcaBrowser: {
              label: '桌面端 Orca 浏览器',
              subtitle: '在已配对桌面端的流式浏览器中打开。'
            },
            phoneBrowser: {
              label: '手机浏览器',
              subtitle: '在这台手机上的 Safari、Chrome 或其它浏览器中打开。'
            }
          },
          pickerTitle: '打开终端链接',
          rowLabel: '打开终端链接'
        }
      },
      chatUi: 'Chat UI',
      credentialCleanup: {
        retryA11y: '重试清理配对凭据',
        stillFailed: '仍无法确认清理结果。请稍后重试。',
        title: '配对凭据清理',
        unreadable: '无法检查这台设备上的清理状态。建议重试确认。',
        unconfirmed: '无法确认这台设备上 {{value}} 个凭据已清理。',
        unconfirmedPlural: '无法确认这台设备上 {{value}} 个凭据已清理。'
      },
      language: {
        followsDevice: '跟随这台设备',
        pickerTitle: '语言',
        readFailed: '无法读取语言偏好，已使用系统语言。',
        systemValue: '跟随系统（{{locale}}）',
        title: '语言',
        writeFailed: '语言偏好无法保存，重启后可能会恢复。'
      },
      nativeChat: {
        defaultView: {
          description:
            '选择支持聊天的 Agent 会话（Claude、Codex 以及其它支持聊天的 Agent）在这台设备上的打开方式。终端会显示原始 CLI；Chat UI 会显示类似桌面端应用的聊天界面。你仍然可以在任意单个会话的长按菜单中切换。',
          heading: '默认视图',
          openInChat: '在 Chat UI 中打开会话'
        }
      },
      notifications: '通知',
      privacyPolicy: '隐私政策',
      support: '支持',
      terminal: '终端',
      terminalSettings: {
        customShortcuts: {
          add: '添加自定义快捷键...',
          addDescription: '创建组合键或文字宏',
          deleteLabel: '删除 {{label}} 快捷键',
          empty: '还没有自定义快捷键。',
          heading: '自定义快捷键',
          modal: {
            add: '添加',
            addShortcut: '添加快捷键',
            addTitle: '添加快捷键',
            command: '命令',
            commandPlaceholder: '例如 pnpm build',
            key: '按键',
            label: '标签',
            labelPlaceholder: '例如 Build',
            manageShortcuts: '管理快捷键',
            manageShortcutsDescription: '显示、隐藏或重新排序快捷键',
            modifiers: '修饰键',
            moreKeys: '更多按键 - Tab、方向键、F1-F12...',
            pickKeyTitle: '选择按键',
            pressEnter: '按下 Enter',
            shortcutComboDescription: '组合 Ctrl、Alt 和 Shift 按键',
            shortcutComboTitle: '组合快捷键',
            specialGroups: {
              editing: '编辑',
              function: '功能键',
              navigation: '导航'
            },
            textMacroDescription: '发送自定义文字命令',
            textMacroTitle: '文字宏'
          }
        },
        keyboard: {
          autocompleteLabel: '自动补全与自动纠错',
          description:
            '在终端命令栏中启用手机式自动补全、自动纠错和拼写建议。默认关闭，避免键盘改写命令、参数或路径。直接键盘输入（按键直接进入终端）始终发送原始按键，因此不会使用建议。',
          heading: '键盘输入'
        },
        restore: {
          description:
            '当你在手机上使用终端时，Orca 会将终端缩小以适配屏幕。关闭应用或切到后台时，这里控制它是保持手机尺寸（避免交互式 CLI 工具重新排版），还是恢复为桌面端尺寸。你也可以随时使用横幅上的“恢复此终端”或“恢复全部终端”手动调整。',
          empty: '还没有已配对的桌面端。配对后即可控制终端行为。',
          heading: '离开应用时',
          options: {
            afterFiveMinutes: '5 分钟后',
            afterOneMinute: '1 分钟后',
            afterSeconds: '{{seconds}} 秒后',
            afterThirtyMinutes: '30 分钟后',
            indefinite: '保持手机尺寸（默认）'
          },
          pickerTitle: '恢复 {{name}}'
        },
        shortcuts: {
          description: '切换快捷键的显示或隐藏，并{{orderAction}}来设置顺序。',
          heading: '快捷键栏',
          orderActionDrag: '拖动把手',
          orderActionHarmony: '使用上移/下移控件',
          resetDefaults: '恢复默认',
          resetDefaultsDescription: '按原始顺序显示每个内置快捷键'
        },
        textSize: {
          description:
            '缩放终端文字。较小字号可在两侧留白时显示更多列；较大字号会显示更少列，可横向拖动平移。你也可以在终端中双指缩放，这会更新此设置。此设置仅影响本设备显示，不会改变桌面端终端。',
          heading: '文字大小',
          options: {
            default: '默认（100%）',
            large: '大（125%）',
            larger: '更大（150%）',
            largest: '最大（200%）',
            smaller: '较小（75%）',
            smallest: '最小（50%）'
          },
          pickerTitle: '终端文字大小',
          rowLabel: '文字大小'
        }
      },
      title: '设置',
      troubleshooting: '故障排查',
      values: {
        off: '关闭',
        on: '开启'
      },
      voice: '语音'
    }
  }
} as const

export default settings
