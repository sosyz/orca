const pairing = {
  mobile: {
    pairing: {
      backToHome: '返回首页',
      confirm: {
        body: '你打开了来自桌面端的配对链接。确认后会把它加入主机列表。',
        pair: '配对',
        title: '要与这台桌面端配对吗？'
      },
      errors: {
        failed: '配对失败：{{message}}',
        invalidCode: '配对码无效',
        invalidCodeWithHint: '配对码无效 - 请从电脑复制后再粘贴',
        invalidQr: '不是有效的 Orca 二维码',
        missingCode: '缺少配对码',
        timeout: '{{seconds}} 秒内未连接成功 - 请查看下面的日志了解卡住的位置',
        unknown: '未知错误'
      },
      logTitle: '配对日志',
      paste: {
        button: '改为粘贴配对码',
        message: '复制电脑上二维码下方显示的代码。',
        orButton: '或粘贴配对码',
        placeholder: 'orca://pair?code=... 或直接粘贴代码',
        title: '粘贴配对码'
      },
      permission: {
        body: '扫描桌面端 Orca 中的二维码，也可以改为粘贴配对码。',
        disabledBody: '请在设置中开启相机权限，或改为粘贴配对码。',
        disabledTitle: '相机权限已关闭',
        title: '配对桌面端'
      },
      scanSteps: {
        open: '在电脑上打开 Orca',
        scan: '扫描二维码',
        settings: '前往设置 > 移动端'
      }
    }
  }
} as const

export default pairing
