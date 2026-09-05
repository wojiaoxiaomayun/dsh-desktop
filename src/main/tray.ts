import { app, Menu, nativeImage, Tray } from 'electron'
import { emitLog, getCurrentProfile, getMainWindow, navigateRenderer } from './state'
import {
  navigateBackend,
  openDevtools,
  openInBrowser,
  reloadCurrent,
  switchProfile,
} from './backend'
import { scanProfiles } from './profiles'

let tray: Tray | null = null

function showMain(): void {
  const win = getMainWindow()
  if (!win) return
  win.show()
  win.restore()
  win.focus()
}

/** 创建系统托盘图标和右键菜单。 */
export function createTray(iconPath: string): void {
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image)
  tray.setToolTip('DSH Desktop')
  refreshTrayMenu()
  // 左键单击托盘图标：恢复显示主窗口
  tray.on('click', () => showMain())
}

/** 根据当前 profiles 重建托盘菜单（初始创建与新增 Profile 后共用）。 */
export function refreshTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(buildMenu())
}

function buildMenu(): Menu {
  const profiles = scanProfiles()
  const current = getCurrentProfile()

  const profileItems: Electron.MenuItemConstructorOptions[] = profiles.map((p) => ({
    label: p,
    type: 'checkbox',
    checked: p === current,
    click: () => {
      void switchProfile(p).catch((e) => emitLog(`[错误] ${String(e)}`))
      refreshTrayMenu()
    },
  }))

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: '显示窗口', click: () => showMain() },
    {
      label: '浏览器打开',
      click: () => {
        try {
          openInBrowser()
        } catch (e) {
          emitLog(`[错误] 无法在浏览器中打开：${String(e)}`)
        }
      },
    },
    { type: 'separator' },
    {
      label: '窗口',
      submenu: [
        {
          label: '返回主界面',
          click: () => {
            try {
              navigateBackend()
            } catch (e) {
              emitLog(`[错误] 无法返回主界面：${String(e)}`)
            }
          },
        },
        {
          label: '重新加载',
          click: () => {
            void reloadCurrent().catch((e) => emitLog(`[错误] ${String(e)}`))
          },
        },
      ],
    },
    {
      label: '调试',
      submenu: [
        {
          label: '查看日志',
          click: () => {
            showMain()
            navigateRenderer()
          },
        },
        {
          label: '打开控制台',
          click: () => {
            try {
              openDevtools()
            } catch (e) {
              emitLog(`[错误] 无法打开控制台：${String(e)}`)
            }
          },
        },
      ],
    },
    {
      label: '设置',
      submenu: [
        {
          label: '设置',
          click: () => {
            showMain()
            navigateRenderer('/settings')
          },
        },
        { label: '切换 Profile', submenu: profileItems },
      ],
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]

  return Menu.buildFromTemplate(template)
}
