import { useEffect, useRef } from "react"
import { ArrowLeft, Settings, Terminal } from "lucide-react"

import appIcon from "@/assets/app-icon.png"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  LEVEL_CLASS,
  STATUS_META,
  type BackendStatus,
  type LogLine,
} from "@/lib/splash"

interface SplashPageProps {
  logs: LogLine[]
  status: BackendStatus
  inTauri: boolean
  onReturn: () => void
  onOpenSettings: () => void
}

export default function SplashPage({
  logs,
  status,
  inTauri,
  onReturn,
  onOpenSettings,
}: SplashPageProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新日志到达时自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [logs])

  const meta = STATUS_META[status]
  const StatusIcon = meta.icon

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-3">
          <img
            src={appIcon}
            alt="DSH Desktop"
            className="size-11 shrink-0 rounded-lg ring-1 ring-border"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle>DSH Desktop</CardTitle>
            <CardDescription>DeepSeek Harness 桌面版</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Badge variant={meta.variant}>
            <StatusIcon
              data-icon="inline-start"
              className={cn(status === "starting" && "animate-spin")}
            />
            {meta.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {status === "ready"
              ? "后端已就绪，日志会持续输出"
              : "后端启动后窗口将自动跳转"}
          </span>
        </div>

        <Separator />

        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Terminal className="size-3.5" />
          启动日志
        </div>

        <ScrollArea className="h-72 rounded-lg border border-border bg-muted/30 font-mono text-xs">
          <div className="flex flex-col gap-1 p-3">
            {logs.length === 0 ? (
              <p className="italic text-muted-foreground">等待日志输出…</p>
            ) : (
              logs.map((line) => (
                <div key={line.id} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground/60">
                    [{line.time}]
                  </span>
                  <span
                    className={cn(
                      "min-w-0 break-all whitespace-pre-wrap",
                      LEVEL_CLASS[line.level],
                    )}
                  >
                    {line.text}
                  </span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="justify-center gap-3">
        {inTauri && (
          <Button
            size="sm"
            variant="outline"
            disabled={status !== "ready"}
            onClick={onReturn}
          >
            <ArrowLeft data-icon="inline-start" />
            返回 DSH 界面
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpenSettings}>
          <Settings data-icon="inline-start" />
          设置
        </Button>
        <span className="text-xs text-muted-foreground">
          可通过系统托盘切换 Profile、查看日志或退出
        </span>
      </CardFooter>
    </Card>
  )
}
