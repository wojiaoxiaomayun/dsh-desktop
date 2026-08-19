import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import SettingsPage from "@/components/SettingsPage"
import SplashPage from "@/components/SplashPage"
import {
  classifyLine,
  errMessage,
  type BackendStatus,
  type LogLevel,
  type LogLine,
} from "@/lib/splash"

/** 是否运行在 Tauri WebView 内（否则进入浏览器预览模式，便于单独迭代 UI）。 */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/** 浏览器预览模式只模拟一次启动日志，避免 StrictMode 下重复计时。 */
let mockBooted = false

/** 历史日志重放只执行一次（StrictMode 下 effect 会跑两遍，防止日志重复）。 */
let historyReplayed = false

function now(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 基于 URL hash 的简单路由：#/settings → 设置页，其余 → 日志页。 */
function useRoute(): "logs" | "settings" {
  const [route, setRoute] = useState<"logs" | "settings">(() =>
    window.location.hash.startsWith("#/settings") ? "settings" : "logs",
  )
  useEffect(() => {
    const onHash = () =>
      setRoute(window.location.hash.startsWith("#/settings") ? "settings" : "logs")
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return route
}

export default function App() {
  const route = useRoute()
  const [logs, setLogs] = useState<LogLine[]>([])
  const [status, setStatus] = useState<BackendStatus>("starting")
  const idRef = useRef(0)

  function appendLog(text: string, level: LogLevel = "info") {
    idRef.current += 1
    setLogs((prev) => [
      ...prev.slice(-499),
      { id: idRef.current, time: now(), text, level },
    ])
  }

  useEffect(() => {
    let unlistenLog: UnlistenFn | undefined
    let unlistenState: UnlistenFn | undefined
    let cancelled = false

    async function boot() {
      if (!inTauri) {
        if (mockBooted) return
        mockBooted = true
        appendLog("未检测到 Tauri 环境，进入浏览器预览模式。", "system")
        const lines = [
          "dsh --profile web --host 127.0.0.1 --port 55123",
          "[info] 正在加载 web profile …",
          "[info] 服务已监听 127.0.0.1:55123",
        ]
        for (let i = 0; i < lines.length; i++) {
          await new Promise((r) => setTimeout(r, 450))
          if (cancelled) return
          appendLog(lines[i], i === lines.length - 1 ? "ready" : "info")
        }
        if (!cancelled) setStatus("ready")
        return
      }

      try {
        // 重放缓冲的历史日志（切换回日志页时能看到完整历史）。只执行一次，
        // 避免 StrictMode 双跑 effect 导致日志重复。
        if (!historyReplayed) {
          historyReplayed = true
          try {
            const history = await invoke<string[]>("get_logs")
            for (const line of history) appendLog(line, classifyLine(line))
          } catch {
            // 拉取失败不阻塞启动流程
          }
        }

        unlistenLog = await listen<string>("backend-log", (event) => {
          appendLog(event.payload, classifyLine(event.payload))
        })
        unlistenState = await listen<BackendStatus>("backend-state", (event) => {
          setStatus(event.payload)
        })

        // 后端已在运行（比如从日志页切回）：直接显示“就绪”，不必再启动。
        try {
          const running = await invoke<boolean>("backend_status")
          if (running) {
            setStatus("ready")
          } else {
            appendLog("正在启动 dsh 后端…", "system")
            await invoke("backend_start")
          }
        } catch {
          appendLog("正在启动 dsh 后端…", "system")
          await invoke("backend_start")
        }
      } catch (err) {
        setStatus("error")
        appendLog(`[错误] ${errMessage(err)}`, "error")
      }
    }

    void boot()

    return () => {
      cancelled = true
      unlistenLog?.()
      unlistenState?.()
    }
  }, [])

  function handleReturn() {
    void invoke("navigate_backend").catch((err) => {
      setStatus("error")
      appendLog(`[错误] 无法返回主界面：${errMessage(err)}`, "error")
    })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-muted/40 p-6">
      {route === "settings" ? (
        <SettingsPage />
      ) : (
        <SplashPage
          logs={logs}
          status={status}
          inTauri={inTauri}
          onReturn={handleReturn}
          onOpenSettings={() => {
            window.location.hash = "#/settings"
          }}
        />
      )}
    </div>
  )
}
