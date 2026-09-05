import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type BackendStatus = 'starting' | 'ready' | 'error' | 'timeout'

const api = {
  getLogs: (): Promise<string[]> => ipcRenderer.invoke('get-logs'),
  backendStart: (): Promise<void> => ipcRenderer.invoke('backend-start'),
  backendStatus: (): Promise<boolean> => ipcRenderer.invoke('backend-status'),
  navigateBackend: (): Promise<void> => ipcRenderer.invoke('navigate-backend'),
  listProfiles: (): Promise<string[]> => ipcRenderer.invoke('list-profiles'),
  currentProfile: (): Promise<string> => ipcRenderer.invoke('current-profile'),
  createProfile: (name: string): Promise<void> => ipcRenderer.invoke('create-profile', name),
  switchProfile: (name: string): Promise<void> => ipcRenderer.invoke('switch-profile', name),
  toggleDevtools: (): Promise<boolean> => ipcRenderer.invoke('toggle-devtools'),
  onLog: (cb: (text: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, text: string): void => cb(text)
    ipcRenderer.on('backend-log', listener)
    return () => ipcRenderer.removeListener('backend-log', listener)
  },
  onState: (cb: (status: BackendStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: BackendStatus): void => cb(status)
    ipcRenderer.on('backend-state', listener)
    return () => ipcRenderer.removeListener('backend-state', listener)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
