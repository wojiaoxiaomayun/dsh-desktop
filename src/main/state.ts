import { join } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow, shell, WebContentsView } from 'electron'
import { is } from '@electron-toolkit/utils'
import { defaultProfile, scanProfiles } from './profiles'

export const BACKEND_HOST = '127.0.0.1'

/** 顶部工具栏的高度（px），WebContentsView 需要从其下方开始布局。 */
export const TOOLBAR_HEIGHT = 44

export type BackendStatus = 'starting' | 'ready' | 'error' | 'timeout'

/** 应用级状态：后端进程 PID、当前 profile、启动代数（防竞态）、后端 URL、访问 token、日志缓冲。 */
export const state = {
  pid: null as number | null,
  profile: '',
  generation: 0,
  backendUrl: null as string | null,
  token: null as string | null,
  logs: [] as string[],
}

let mainWindow: BrowserWindow | null = null

/** 承载后端 DSH 界面的独立视图，叠加在主窗口渲染层（外壳+工具栏）之下。 */
let backendView: WebContentsView | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 当前正在使用（或默认将使用）的 profile 名。 */
export function getCurrentProfile(): string {
  if (!state.profile) {
    state.profile = defaultProfile(scanProfiles())
  }
  return state.profile
}

/** 把一条日志写入缓冲（最多 500 条）并广播给前端。 */
export function emitLog(text: string): void {
  state.logs.push(text)
  if (state.logs.length > 500) state.logs.shift()
  mainWindow?.webContents.send('backend-log', text)
}

/** 广播后端状态给前端。 */
export function emitState(status: BackendStatus): void {
  mainWindow?.webContents.send('backend-state', status)
}

/** 渲染层（启动页/设置页）的 URL：dev 用 Vite dev server，生产用打包后的 index.html。 */
export function rendererUrl(hash?: string): string {
  const base =
    is.dev && process.env.ELECTRON_RENDERER_URL
      ? process.env.ELECTRON_RENDERER_URL
      : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  return hash ? `${base}#${hash}` : base
}

/**
 * 导航主窗口到渲染层页面。
 * 外壳已加载时仅切换 hash（触发渲染层 hashchange），避免整体重载丢失状态；
 * 尚未加载时加载外壳 URL（可带初始 hash）。
 */
export function navigateRenderer(hash?: string): void {
  if (!mainWindow) return
  const current = mainWindow.webContents.getURL()
  const isShell = current.startsWith(rendererUrl())
  if (isShell) {
    mainWindow.webContents.executeJavaScript(
      `window.location.hash = ${JSON.stringify(hash ?? '')}`,
    )
    return
  }
  mainWindow.loadURL(rendererUrl(hash))
}

/**
 * 承载后端 DSH 界面的 WebContentsView 的创建、布局与显隐。
 * 视图始终作为主窗口的子视图存在；渲染层外壳（含工具栏）在主窗口 webContents 中，
 * 两者通过 view bounds 的纵向偏移（TOOLBAR_HEIGHT）叠加，工具栏因此常驻后端界面上方。
 */
export function getBackendView(): WebContentsView | null {
  return backendView
}

/** 创建（或复用）后端视图并加载 URL；视图默认隐藏，由 showBackendView() 挂载显示。 */
export function mountBackendView(url: string): WebContentsView {
  if (!mainWindow) throw new Error('主窗口尚未创建')
  if (!backendView) {
    backendView = new WebContentsView({
      webPreferences: {
        sandbox: false,
      },
    })
    // 顶层导航：外部地址交给系统浏览器。
    backendView.webContents.on('will-navigate', onViewNavigate)
    // window.open / target="_blank"：一律外部浏览器打开，不在应用内新开窗口。
    backendView.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  // 若已在主窗口中，先移除以保持“隐藏”状态，避免就绪时遮挡日志页。
  if (isChildOf(mainWindow, backendView)) mainWindow.contentView.removeChildView(backendView)
  layoutBackendView()
  backendView.webContents.loadURL(url)
  return backendView
}

/** 后端视图是否为当前主窗口的子视图。 */
function isChildOf(win: BrowserWindow, view: WebContentsView): boolean {
  return win.contentView.children.includes(view)
}

/** 显示后端视图（重新挂载并按窗口尺寸布局；未加载过 URL 时用当前后端地址加载）。 */
export function showBackendView(): void {
  if (!mainWindow || !backendView) return
  if (!isChildOf(mainWindow, backendView)) mainWindow.contentView.addChildView(backendView)
  const url = backendView.webContents.getURL()
  if (!url || url === 'about:blank') {
    const backendUrl = getBackendUrl()
    if (backendUrl) backendView.webContents.loadURL(backendUrl)
  }
  layoutBackendView()
}

/** 隐藏后端视图（从主窗口移除，保留其实例以便再次显示）。 */
export function hideBackendView(): void {
  if (!mainWindow || !backendView) return
  if (isChildOf(mainWindow, backendView)) mainWindow.contentView.removeChildView(backendView)
}

/** 按窗口当前尺寸把视图放到工具栏下方、占满剩余区域。 */
export function layoutBackendView(): void {
  if (!mainWindow || !backendView) return
  const [width, height] = mainWindow.getContentSize()
  backendView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width,
    height: Math.max(0, height - TOOLBAR_HEIGHT),
  })
}

/** 从主窗口移除并销毁后端视图（用于退出或彻底清理）。 */
export function unmountBackendView(): void {
  if (!backendView) return
  // 窗口可能已销毁（closed 事件），此时无法再操作其 contentView，仅清理视图本身。
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(backendView)
    }
  } catch {
    // 忽略窗口侧的清理失败，继续释放视图
  }
  try {
    backendView.webContents.close()
  } catch {
    // 视图可能已被系统释放
  }
  backendView = null
}

/** 拦截后端视图内导航：仅允许应用内地址，其余交给系统浏览器。 */
function onViewNavigate(event: Electron.Event, url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return
  event.preventDefault()
  if (/^https?:/i.test(url)) shell.openExternal(url)
}

/** 后端主界面完整 URL（新版 dsh 需要 token 鉴权，若有则拼上 ?token=…）。 */
export function getBackendUrl(): string | null {
  if (!state.backendUrl) return null
  return state.token ? `${state.backendUrl}?token=${state.token}` : state.backendUrl
}

