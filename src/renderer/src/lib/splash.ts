import type { Component } from 'vue'
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from '@lucide/vue'

export type LogLevel = 'info' | 'error' | 'ready' | 'system'

export interface LogLine {
  id: number
  time: string
  text: string
  level: LogLevel
}

export type BackendStatus = 'starting' | 'ready' | 'error' | 'timeout'

export interface StatusMeta {
  label: string
  variant: 'outline' | 'success' | 'destructive'
  icon: Component
}

export const STATUS_META: Record<BackendStatus, StatusMeta> = {
  starting: { label: '正在启动后端…', variant: 'outline', icon: LoaderCircleIcon },
  ready: { label: '后端已就绪', variant: 'success', icon: CircleCheckIcon },
  error: { label: '后端启动出错', variant: 'destructive', icon: CircleXIcon },
  timeout: { label: '后端启动超时', variant: 'destructive', icon: CircleXIcon },
}

export const LEVEL_CLASS: Record<LogLevel, string> = {
  info: 'text-foreground',
  error: 'text-destructive',
  ready: 'text-success',
  system: 'text-muted-foreground italic',
}

export function classifyLine(text: string): LogLevel {
  if (text.startsWith('[错误]')) return 'error'
  if (text.startsWith('[就绪]')) return 'ready'
  return 'info'
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
