import { ElectronAPI } from '@electron-toolkit/preload'

export type BackendStatus = 'starting' | 'ready' | 'error' | 'timeout'

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
  onLog: (cb: (text: string) => void) => () => void
  onState: (cb: (status: BackendStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DshApi
  }
}
