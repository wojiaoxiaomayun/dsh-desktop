import { join } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { defaultProfile, scanProfiles } from './profiles'

export const BACKEND_HOST = '127.0.0.1'

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

/** 导航主窗口回渲染层（启动页/设置页）。 */
export function navigateRenderer(hash?: string): void {
  mainWindow?.loadURL(rendererUrl(hash))
}

/** 导航主窗口到指定 URL（后端主界面）。 */
export function navigateToUrl(url: string): void {
  mainWindow?.loadURL(url)
}

/** 后端主界面完整 URL（新版 dsh 需要 token 鉴权，若有则拼上 ?token=…）。 */
export function getBackendUrl(): string | null {
  if (!state.backendUrl) return null
  return state.token ? `${state.backendUrl}?token=${state.token}` : state.backendUrl
}
