import type { Component } from 'vue'
import {
  CircleCheckIcon,
  CircleXIcon,
  DownloadCloudIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from '@lucide/vue'

/** 更新流程阶段（需与 src/main/updater.ts 保持一致）。 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseNotes: string | null
  percent: number
  error: string | null
}

export interface UpdateMeta {
  label: string
  variant: 'outline' | 'success' | 'destructive' | 'secondary'
  icon: Component
}

export const UPDATE_META: Record<UpdatePhase, UpdateMeta> = {
  idle: { label: '尚未检查', variant: 'outline', icon: RefreshCwIcon },
  checking: { label: '正在检查…', variant: 'outline', icon: LoaderCircleIcon },
  'not-available': { label: '已是最新', variant: 'success', icon: CircleCheckIcon },
  available: { label: '发现新版本', variant: 'secondary', icon: DownloadCloudIcon },
  downloading: { label: '正在下载…', variant: 'outline', icon: LoaderCircleIcon },
  downloaded: { label: '待重启安装', variant: 'success', icon: DownloadCloudIcon },
  error: { label: '更新失败', variant: 'destructive', icon: CircleXIcon },
}

/** 各阶段下的一句话说明。 */
export function updateHint(state: UpdateState): string {
  switch (state.phase) {
    case 'idle':
      return '应用启动后会自动检查一次更新，也可以随时手动检查。'
    case 'checking':
      return '正在从 GitHub Releases 获取版本信息…'
    case 'not-available':
      return '当前版本已是最新。'
    case 'available':
      return '正在后台下载新版本…'
    case 'downloading':
      return '正在下载新版本，完成后会提示重启安装。'
    case 'downloaded':
      return '新版本已下载完成，重启应用后自动安装。'
    case 'error':
      return '更新检查失败，可稍后重试。'
    default:
      return ''
  }
}
