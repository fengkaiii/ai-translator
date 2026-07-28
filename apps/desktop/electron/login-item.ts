import { app } from 'electron'

/** 同步开机自启到系统登录项（与设置字段 launchAtLogin 对齐） */
export function syncLaunchAtLogin(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // 打包后使用可执行文件路径；开发态 Electron 也可能写入，但不保证可靠
      path: process.execPath
    })
  } catch (err) {
    console.warn('[login-item] setLoginItemSettings failed:', err)
  }
}
