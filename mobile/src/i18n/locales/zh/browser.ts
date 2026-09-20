const browser = {
  mobile: {
    browser: {
      address: {
        placeholder: '输入 URL'
      },
      dialog: {
        cancel: '取消',
        ok: '确定',
        title: '浏览器对话框'
      },
      errors: {
        checkingSupport: '正在检查桌面端是否支持浏览器串流。',
        commandFailed: '浏览器命令失败',
        dialogFallbackMessage: '浏览器对话框',
        invalidUrl: '请输入有效的 URL。',
        pageUnavailable: '浏览器页面暂时不可用。',
        streamFailed: '浏览器串流失败。',
        streamTimedOut: '浏览器串流超时。',
        streamUnsupported: '请更新桌面端 Orca，以在移动端串流浏览器标签页。'
      },
      keyboard: {
        inputPlaceholder: '在页面输入…',
        keys: {
          backspace: {
            accessibilityLabel: '删除键',
            label: '⌫'
          },
          enter: {
            accessibilityLabel: '回车键',
            label: 'Enter'
          },
          escape: {
            accessibilityLabel: '退出键',
            label: 'Esc'
          },
          tab: {
            accessibilityLabel: 'Tab 键',
            label: 'Tab'
          }
        },
        sendTextAccessibilityLabel: '发送文本到浏览器'
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
        modifierAccessibilityLabel: '{{label}} 点击修饰键',
        shift: {
          label: 'Shift'
        }
      },
      toasts: {
        rightClick: '右键点击',
        sent: '已发送'
      },
      toolbar: {
        back: '后退',
        forward: '前进',
        reload: '重新加载'
      },
      viewMode: {
        mobile: {
          accessibilityLabel: '显示移动网页视图',
          label: '移动'
        },
        web: {
          accessibilityLabel: '显示桌面网页视图',
          label: '桌面'
        }
      }
    }
  }
} as const

export default browser
