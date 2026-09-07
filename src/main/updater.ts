import { app, ipcMain, Notification } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { emitLog, getMainWindow } from './state'

/** 更新流程阶段。 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 更新状态快照：广播给渲染层，也供渲染层首次挂载时拉取。 */
export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseNotes: string | null
  /** 下载进度 0–100 */
  percent: number
  error: string | null
}

let state: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  latestVersion: null,
  releaseNotes: null,
  percent: 0,
  error: null,
}

/** 已弹出过“更新已就绪”的系统通知，避免重复打扰。 */
let notified = false

/** 统一错误信息：GitHub 上没有任何 Release 时会报 404，换成更友好的提示。 */
function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return /404|not found/i.test(msg) ? '未找到已发布版本（404）' : msg
}

/** electron-updater 的 releaseNotes 可能是字符串，也可能是 ReleaseNoteInfo 数组。 */
function toNotes(info: UpdateInfo): string | null {
  const rn = info.releaseNotes as string | Array<{ note?: string | null }> | null | undefined
  if (!rn) return null
  if (typeof rn === 'string') return rn
  if (Array.isArray(rn)) {
    const text = rn
      .map((n) => n?.note ?? '')
      .filter(Boolean)
      .join('\n')
    return text || null
  }
  return null
}

/** 广播最新状态给渲染层。 */
function push(): void {
  getMainWindow()?.webContents.send('update-state', { ...state })
}

/** 更新状态并可选地写一条日志（日志会同时出现在日志页）。 */
function setState(patch: Partial<UpdateState>, log?: string): void {
  if (log) emitLog(log)
  state = { ...state, ...patch }
  push()
}

/** 下载更新包。 */
async function startDownload(): Promise<void> {
  setState({ phase: 'downloading', percent: 0, error: null })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    setState({ phase: 'error', error: errText(err) }, `[更新] 下载失败：${errText(err)}`)
  }
}

/** 向 GitHub Releases 检查更新；发现新版本会自动开始下载。 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    // 开发/预览模式没有 app-update.yml，直接跳过
    setState({ phase: 'error', error: '开发模式不支持检查更新' }, '[更新] 开发模式已跳过更新检查')
    return { ...state }
  }
  if (state.phase === 'checking' || state.phase === 'downloading') return { ...state }

  setState({ phase: 'checking', error: null }, '[更新] 正在检查更新…')
  try {
    const result = await autoUpdater.checkForUpdates()
    // 正常情况下状态已由事件回调更新；这里只在完全没有结果时兜底
    if (!result) setState({ phase: 'not-available' }, '[更新] 未检测到新版本')
  } catch (err) {
    setState({ phase: 'error', error: errText(err) }, `[更新] 检查更新失败：${errText(err)}`)
  }
  return { ...state }
}

/** 退出并安装已下载的新版本。 */
export function installUpdate(): void {
  if (state.phase !== 'downloaded') throw new Error('更新尚未下载完成')
  // 静默安装（Windows 走 /S，其余平台本来就是静默），安装完成后自动重启应用。
  // 内部走 app.quit()，会先触发 before-quit，因此不会被“关闭即隐藏到托盘”拦截。
  autoUpdater.quitAndInstall(true, true)
}

/** 下载完成后弹一次系统通知（窗口可能已隐藏到托盘）。 */
function notify(version: string): void {
  if (notified || !Notification.isSupported()) return
  notified = true
  const notification = new Notification({
    title: 'DSH Desktop 新版本已就绪',
    body: `v${version} 已下载完成，重启应用后自动安装`,
  })
  notification.on('click', () => {
    const win = getMainWindow()
    win?.show()
    win?.focus()
  })
  notification.show()
}

/** 注册 electron-updater 事件：检查 → 自动下载 → 通知 → 用户重启安装。 */
function setup(): void {
  state.currentVersion = app.getVersion()

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking', error: null }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState(
      {
        phase: 'available',
        latestVersion: info.version,
        releaseNotes: toNotes(info),
        percent: 0,
        error: null,
      },
      `[更新] 发现新版本 v${info.version}（当前 v${app.getVersion()}），开始下载…`,
    )
    void startDownload()
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setState(
      { phase: 'not-available', latestVersion: info.version, percent: 0, error: null },
      '[更新] 当前已是最新版本',
    )
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState({ phase: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    notified = false
    setState(
      { phase: 'downloaded', latestVersion: info.version, percent: 100, error: null },
      `[更新] v${info.version} 已下载完成，重启应用即可安装`,
    )
    notify(info.version)
  })

  autoUpdater.on('error', (err: Error) => {
    setState({ phase: 'error', error: errText(err) }, `[更新] 更新失败：${errText(err)}`)
  })
}

/** 初始化自动更新：注册事件后延迟做一次静默检查。 */
export function initUpdater(): void {
  setup()
  // 启动 8 秒后再检查，避免和后端启动抢网络、拖慢首屏
  setTimeout(() => void checkForUpdates(), 8_000)
}

/** 注册渲染层可用的更新相关 IPC。 */
export function registerUpdateIpc(): void {
  ipcMain.handle('update-get-state', () => ({ ...state }))
  ipcMain.handle('update-check', () => checkForUpdates())
  ipcMain.handle('update-install', () => {
    installUpdate()
  })
}
