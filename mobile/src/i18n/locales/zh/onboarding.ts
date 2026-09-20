const onboarding = {
  mobile: {
    onboarding: {
      errors: {
        notifications: '通知设置无法更新。请重试。',
        sessionView: '你的选择无法保存。请重试。'
      },
      notifications: {
        body: '当 Agent 需要你输入或完成任务时，在这台设备上通知你。',
        enable: '开启通知',
        enableA11y: '开启 Agent 通知',
        skip: '暂不',
        skipA11y: '暂时跳过通知',
        title: '离开时也不错过进展'
      },
      progressLabel: '新手引导进度',
      progressValue: '第 {{current}} 步，共 {{total}} 步',
      sessionView: {
        body: '选择这台设备上受支持的 Agent 会话默认以终端还是 Chat UI 打开。长按会话标签可切换视图，也可以稍后在设置中修改默认值。',
        chat: '使用 Chat UI',
        chatA11y: '以 Chat UI 打开会话',
        terminal: '保留终端',
        terminalA11y: '在终端中打开会话',
        title: '会话默认怎么打开？'
      }
    }
  }
} as const

export default onboarding
