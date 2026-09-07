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

export interface DshApi {
  getLogs: () => Promise<string[]>
  backendStart: () => Promise<void>
  backendStatus: () => Promise<boolean>
  navigateBackend: () => Promise<void>
  listProfiles: () => Promise<string[]>
  currentProfile: () => Promise<string>
  createProfile: (name: string) => Promise<void>
  switchProfile: (name: string) => Promise<void>
  toggleDevtools: () => Promise<boolean>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  installUpdate: () => Promise<void>
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
