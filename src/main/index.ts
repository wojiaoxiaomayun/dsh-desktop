import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import {
  emitLog,
  getCurrentProfile,
  rendererUrl,
  setMainWindow,
  state,
} from './state'
import {
  backendStart,
  backendStatus,
  killAll,
  navigateBackend,
  switchProfile,
  toggleDevtools,
} from './backend'
import { createProfile, scanProfiles, validateProfileName } from './profiles'
import { createTray, refreshTrayMenu } from './tray'

let isQuitting = false

/** 判定一个 URL 是否属于应用内部：打包后的启动页 + 本地后端（127.0.0.1 / localhost）。 */
function isInternalUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    return u.pathname.replace(/\\/g, '/').endsWith('/out/renderer/index.html')
  }
  return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 关闭主窗口仅隐藏到托盘，不退出进程；退出由托盘菜单“退出”完成。
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // window.open / target="_blank"：在默认浏览器打开，不在应用内新建窗口。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 页面导航：允许启动页与本地后端；其余交给默认浏览器并取消导航。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  mainWindow.loadURL(rendererUrl())
}

function registerIpc(): void {
  ipcMain.handle('get-logs', () => state.logs.slice())
  ipcMain.handle('backend-start', () => backendStart())
  ipcMain.handle('backend-status', () => backendStatus())
  ipcMain.handle('navigate-backend', () => navigateBackend())
  ipcMain.handle('list-profiles', () => scanProfiles())
  ipcMain.handle('current-profile', () => getCurrentProfile())
  ipcMain.handle('create-profile', (_e, name: string) => {
    const trimmed = String(name ?? '').trim()
    const err = validateProfileName(trimmed)
    if (err) throw new Error(err)
    createProfile(trimmed)
    emitLog(`[info] 已创建 Profile “${trimmed}”`)
    refreshTrayMenu()
  })
  ipcMain.handle('switch-profile', async (_e, name: string) => {
    await switchProfile(String(name))
    refreshTrayMenu()
  })
  ipcMain.handle('toggle-devtools', () => toggleDevtools())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dsh.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()
  createTray(trayIcon)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出时回收后端进程树。
app.on('before-quit', () => {
  isQuitting = true
  killAll()
})
