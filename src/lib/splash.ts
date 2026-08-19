import type { VariantProps } from "class-variance-authority"
import {
  CircleCheck,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react"

import { badgeVariants } from "@/components/ui/badge"

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"]

export type LogLevel = "info" | "error" | "ready" | "system"

export interface LogLine {
  id: number
  time: string
  text: string
  level: LogLevel
}

export type BackendStatus = "starting" | "ready" | "error" | "timeout"

export const STATUS_META: Record<
  BackendStatus,
  { label: string; variant: BadgeVariant; icon: LucideIcon }
> = {
  starting: { label: "正在启动后端…", variant: "outline", icon: LoaderCircle },
  ready: { label: "后端已就绪", variant: "success", icon: CircleCheck },
  error: { label: "后端启动出错", variant: "destructive", icon: CircleX },
  timeout: { label: "后端启动超时", variant: "destructive", icon: CircleX },
}

export const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "text-foreground",
  error: "text-destructive",
  ready: "text-success",
  system: "text-muted-foreground italic",
}

export function classifyLine(text: string): LogLevel {
  if (text.startsWith("[错误]")) return "error"
  if (text.startsWith("[就绪]")) return "ready"
  return "info"
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
