import { app, Menu, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import {
  emitLog,
  getCurrentProfile,
  getMainWindow,
  hideBackendView,
  layoutBackendView,
  rendererUrl,
  setMainWindow,
  showBackendView,
  state,
  unmountBackendView,
} from './state'
import {
  backendStart,
  backendStatus,
  killAll,
  navigateBackend,
  reloadCurrent,
  reloadPage,
  switchProfile,
  toggleDevtools,
} from './backend'
import { createProfile, scanProfiles, validateProfileName } from './profiles'
import { addPlugins, listPlugins, removePlugin } from './plugins'
import { createTray, refreshTrayMenu } from './tray'
import { initUpdater, registerUpdateIpc } from './updater'
import { registerDshVersionIpc } from './dsh'

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
    // 无头窗口：隐藏系统标题栏/边框，由渲染层工具栏充当自定义标题栏。
    frame: false,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 窗口尺寸变化时同步内嵌后端视图的 bounds，使其始终贴合工具栏下方。
  mainWindow.on('resize', () => layoutBackendView())
  mainWindow.on('maximize', () => {
    layoutBackendView()
    mainWindow.webContents.send('window-maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    layoutBackendView()
    mainWindow.webContents.send('window-maximized', false)
  })

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

  // 外壳渲染层导航：始终停留在本地渲染层；其余交给默认浏览器并取消导航。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  // 始终加载渲染层外壳（工具栏常驻），后端界面由内嵌 WebContentsView 承载。
  mainWindow.loadURL(rendererUrl())

  mainWindow.on('closed', () => {
    unmountBackendView()
  })
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
  ipcMain.handle('reload-profile', async () => {
    await reloadCurrent()
    refreshTrayMenu()
  })
  ipcMain.handle('list-plugins', (_e, name: string) => listPlugins(String(name)))
  ipcMain.handle('add-plugins', async (_e, name: string, specs: string[]) => {
    const profile = String(name)
    const clean = Array.isArray(specs)
      ? specs.map((s) => String(s).trim()).filter((s) => s.length > 0)
      : []
    if (clean.length === 0) throw new Error('请至少输入一个插件包名')
    const result = await addPlugins(profile, clean)
    refreshTrayMenu()
    return result
  })
  ipcMain.handle('remove-plugin', async (_e, name: string, pluginName: string) => {
    const result = await removePlugin(String(name), String(pluginName))
    refreshTrayMenu()
    return result
  })
  ipcMain.handle('toggle-devtools', () => toggleDevtools())
  ipcMain.handle('reload-page', () => reloadPage())
  // 渲染层切换视图模式：'app' → 显示内嵌后端视图，其余 → 隐藏。
  ipcMain.on('set-view-mode', (_e, mode: string) => {
    if (mode === 'app') showBackendView()
    else hideBackendView()
  })
  // 无头窗口的自定义标题栏控制。
  ipcMain.handle('window-minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('window-maximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window-close', () => getMainWindow()?.close())
  registerUpdateIpc()
  registerDshVersionIpc()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dsh.desktop')

  // 放开默认拦截的快捷键（Ctrl+R 等）：Electron 默认菜单的 Reload/DevTools accelerator
  // 和 @electron-toolkit/utils 的 watchWindowShortcuts 都会在浏览器层把 Ctrl+R
  // 拦截掉，内嵌页面（webview）完全监听不到。这里去掉默认菜单（Windows/Linux），
  // 也不再挂 before-input-event 拦截，把按键原样交给页面自己处理。
  if (process.platform === 'darwin') {
    // macOS 必须保留菜单（否则 Cmd+C/Cmd+V 失效）；App/Edit 菜单不含会吞按键的 accelerator。
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  // 仅开发模式保留 F12 开关 DevTools；不拦截任何按键，页面照常收到事件。
  app.on('browser-window-created', (_, window) => {
    if (!is.dev) return
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.code === 'F12') {
        window.webContents.toggleDevTools()
      }
    })
  })

  registerIpc()
  createWindow()
  createTray(trayIcon)
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出时回收后端进程树。
app.on('before-quit', () => {
  isQuitting = true
  killAll()
})
