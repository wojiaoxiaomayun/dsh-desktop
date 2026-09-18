import { join } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow, session, shell, WebContentsView } from 'electron'
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
    // 落在 401 页面上说明这次导航没带上（或带错了）访问 token，就地自愈重载。
    backendView.webContents.on('did-navigate', (_event, _url, httpResponseCode) => {
      if (httpResponseCode === 401) recoverBackendAuth()
    })
    // window.open / target="_blank"：一律外部浏览器打开，不在应用内新开窗口。
    backendView.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  // 若已在主窗口中，先移除以保持“隐藏”状态，避免就绪时遮挡日志页。
  if (isChildOf(mainWindow, backendView)) mainWindow.contentView.removeChildView(backendView)
  resetBackendAuth()
  layoutBackendView()
  backendView.webContents.loadURL(url).catch((err) => {
    emitLog(`[警告] 后端视图加载被中断：${err instanceof Error ? err.message : String(err)}`)
  })
  return backendView
}

/** 401 自愈：同一轮启动最多重载的次数，避免 token 失效时反复刷新。 */
const AUTH_RECOVERY_LIMIT = 2

let authRecoveryCount = 0
let authRecoveryPending = false

/**
 * 后端视图被 401 拒绝时的自愈：带着当前 token 重新加载。
 * token 尚未从日志中解析出来时先记为待处理，等 token 到手后再补一次重载，
 * 否则视图会一直停在 “authentication required” 的空白页上。
 */
export function recoverBackendAuth(): void {
  if (!backendView) return
  if (!state.token || !state.backendUrl) {
    authRecoveryPending = true
    return
  }
  if (authRecoveryCount >= AUTH_RECOVERY_LIMIT) {
    emitLog('[错误] 后端视图多次因缺少有效 token 被拒绝，请重新加载后端')
    return
  }
  authRecoveryCount += 1
  authRecoveryPending = false
  emitLog(`[鉴权] 视图缺少访问 token，正在带 token 重新加载：${state.backendUrl}`)
  backendView.webContents.loadURL(`${state.backendUrl}?token=${state.token}`).catch(() => {
    // 重载被后续导航取代属正常情况
  })
}

/** 新解析出 token 后补做一次待处理的自愈重载。 */
export function flushBackendAuth(): void {
  if (authRecoveryPending) recoverBackendAuth()
}

/** 每轮新的后端导航重新开始计次，避免上一轮的失败次数影响本轮。 */
export function resetBackendAuth(): void {
  authRecoveryCount = 0
  authRecoveryPending = false
}

/** 当前页面是否还持有 dsh 的认证 Cookie（名字由 dsh 按 authority 哈希生成，故只认前缀）。 */
async function hasBackendAuthCookie(url: string): Promise<boolean> {
  try {
    const list = await session.defaultSession.cookies.get({ url })
    return list.some((c) => c.name.startsWith('dsh-auth-'))
  } catch {
    return false
  }
}

/**
 * 刷新后端视图当前页面。
 * 认证 Cookie 仍在时就地 reload，保留单页应用内部的当前路由；
 * Cookie 已丢失（例如被清理过）时 reload 只会再拿回一个 401 空白页，
 * 因此改为带 token 重新加载一次，让后端重新种下 Cookie。
 */
export async function reloadBackendView(): Promise<void> {
  if (!backendView) throw new Error('后端视图尚未创建')
  const wc = backendView.webContents
  // 后端不要求 token（旧版 dsh）时没有 Cookie 可言，就地刷新即可。
  if (!state.token) {
    wc.reload()
    return
  }
  const current = wc.getURL()
  if (current && !current.startsWith('about:') && (await hasBackendAuthCookie(current))) {
    wc.reload()
    return
  }
  const url = getBackendUrl()
  if (!url) throw new Error('后端尚未启动，暂无可刷新的页面')
  emitLog('[鉴权] 认证 Cookie 已失效，正在带 token 重新加载页面')
  resetBackendAuth()
  await wc.loadURL(url)
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
    if (backendUrl) {
      resetBackendAuth()
      backendView.webContents.loadURL(backendUrl).catch(() => {
        // 由 did-navigate 的 401 自愈兜底
      })
    }
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

