import { ElectronAPI } from '@electron-toolkit/preload'

export type BackendStatus = 'starting' | 'ready' | 'error' | 'timeout'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  /** 当前流程阶段 */
  phase: UpdatePhase
  /** 当前运行版本 */
  currentVersion: string
  /** 远端最新版本号 */
  latestVersion: string | null
  /** 更新日志（纯文本，可能包含 Markdown） */
  releaseNotes: string | null
  /** 下载进度 0–100 */
  percent: number
  /** 出错信息 */
  error: string | null
}

export interface PluginInfo {
  name: string
  version: string
}

/** dsh CLI 版本检查阶段（需与 src/main/dsh.ts 保持一致）。 */
export type DshVersionStatus = 'unknown' | 'checking' | 'latest' | 'outdated' | 'ahead' | 'error'

export interface DshVersionState {
  /** 本机安装的 dsh 版本；未检测到为 null */
  current: string | null
  /** npm 上的最新版本；尚未检查为 null */
  latest: string | null
  /** 检查结果状态 */
  status: DshVersionStatus
  /** 最近一次检查的时间戳（ms） */
  checkedAt: number | null
  /** 出错信息 */
  error: string | null
}

export interface DshApi {
  getLogs: () => Promise<string[]>
  backendStart: () => Promise<void>
  backendStatus: () => Promise<boolean>
  navigateBackend: () => Promise<void>
  listProfiles: () => Promise<string[]>
  currentProfile: () => Promise<string>
  createProfile: (name: string) => Promise<void>
  switchProfile: (name: string) => Promise<void>
  reloadProfile: () => Promise<void>
  listPlugins: (name: string) => Promise<PluginInfo[]>
  addPlugins: (name: string, specs: string[]) => Promise<PluginInfo[]>
  removePlugin: (name: string, pluginName: string) => Promise<PluginInfo[]>
  toggleDevtools: () => Promise<boolean>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  installUpdate: () => Promise<void>
  getDshVersion: () => Promise<DshVersionState>
  checkDshLatest: () => Promise<DshVersionState>
  onLog: (cb: (text: string) => void) => () => void
  onState: (cb: (status: BackendStatus) => void) => () => void
  onUpdate: (cb: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DshApi
  }
}
