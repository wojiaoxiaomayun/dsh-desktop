import type { Component } from 'vue'
import {
  ArrowUpCircleIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  LoaderCircleIcon,
  SparklesIcon
} from '@lucide/vue'

/** dsh CLI 在 npm 上的包名。 */
export const DSH_PACKAGE = '@deepseek-ai/dsh'

/** 升级本机 dsh 的命令（设置页会展示）。 */
export const DSH_UPGRADE_COMMAND = `npm i -g ${DSH_PACKAGE}@latest`

/** dsh 版本检查阶段（需与 src/main/dsh.ts 保持一致）。 */
export type DshVersionStatus = 'unknown' | 'checking' | 'latest' | 'outdated' | 'ahead' | 'error'

export interface DshVersionState {
  current: string | null
  latest: string | null
  status: DshVersionStatus
  checkedAt: number | null
  error: string | null
}

export interface DshVersionMeta {
  label: string
  variant: 'outline' | 'success' | 'destructive' | 'secondary'
  icon: Component
}

export const DSH_STATUS_META: Record<DshVersionStatus, DshVersionMeta> = {
  unknown: { label: '尚未检查', variant: 'outline', icon: CircleHelpIcon },
  checking: { label: '正在检查…', variant: 'outline', icon: LoaderCircleIcon },
  latest: { label: '已是最新', variant: 'success', icon: CircleCheckIcon },
  outdated: { label: '有新版本', variant: 'secondary', icon: ArrowUpCircleIcon },
  ahead: { label: '高于 npm 版本', variant: 'outline', icon: SparklesIcon },
  error: { label: '检查失败', variant: 'destructive', icon: CircleXIcon }
}

/** 各阶段下的一句话说明。 */
export function dshHint(state: DshVersionState, idle: boolean): string {
  if (idle) return '点击“检查最新版本”通过 npm 查询本机是否已是最新。'
  switch (state.status) {
    case 'unknown':
      return '尚未获取到版本信息，可重新检查。'
    case 'checking':
      return `正在查询 npm 上的 ${DSH_PACKAGE} …`
    case 'latest':
      return '本机 dsh 与 npm 上的最新版本一致。'
    case 'outdated':
      return `npm 上已有 v${state.latest}，可用下方命令升级本机 dsh。`
    case 'ahead':
      return '本机版本高于 npm 上的 latest，可能是本地构建版或更高的预发布版。'
    case 'error':
      return '检查失败，请确认网络连通或 npm 配置后重试。'
    default:
      return ''
  }
}

/** 最近一次检查时间的可读文本。 */
export function checkedAtText(ts: number | null): string | null {
  if (!ts) return null
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
