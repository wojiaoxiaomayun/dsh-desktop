<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppToolbar from '@/components/AppToolbar.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import SplashPage from '@/components/SplashPage.vue'
import {
  classifyLine,
  errMessage,
  type BackendStatus,
  type LogLevel,
  type LogLine,
} from '@/lib/splash'

/** 是否运行在 Electron 环境内（否则进入浏览器预览模式，便于单独迭代 UI）。 */
const inElectron = typeof window !== 'undefined' && 'api' in window

/** 浏览器预览模式只模拟一次启动日志，避免 StrictMode 下重复计时。 */
let mockBooted = false

/** 历史日志重放只执行一次。 */
let historyReplayed = false

function now(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 基于 URL hash 的简单路由，所有页面都在整体框架（工具栏常驻）内切换：
 * - #/app（默认）→ 后端 DSH 界面：内容区由主进程的 WebContentsView 覆盖
 * - #/logs → 日志页（启动时默认显示）
 * - #/settings → 设置页
 */
type Route = 'app' | 'logs' | 'settings'

function hashToRoute(hash: string): Route {
  if (hash.startsWith('#/app')) return 'app'
  if (hash.startsWith('#/settings')) return 'settings'
  return 'logs'
}

const route = ref<Route>(hashToRoute(window.location.hash))

/** 同步主进程中的内嵌后端视图显隐：仅 app 模式显示。 */
function syncViewMode(): void {
  if (inElectron) window.api.setViewMode(route.value)
}

function onHash(): void {
  route.value = hashToRoute(window.location.hash)
  syncViewMode()
}

const logs = ref<LogLine[]>([])
const status = ref<BackendStatus>('starting')
const maximized = ref(false)
let idRef = 0

function appendLog(text: string, level: LogLevel = 'info'): void {
  idRef += 1
  logs.value = [...logs.value.slice(-499), { id: idRef, time: now(), text, level }]
}

let unlistenLog: (() => void) | undefined
let unlistenState: (() => void) | undefined
let unlistenMax: (() => void) | undefined
let cancelled = false

async function boot(): Promise<void> {
  if (!inElectron) {
    if (mockBooted) return
    mockBooted = true
    appendLog('未检测到 Electron 环境，进入浏览器预览模式。', 'system')
    const lines = [
      'dsh --profile web --host 127.0.0.1 --port 55123',
      '[info] 正在加载 web profile …',
      '[info] 服务已监听 127.0.0.1:55123',
    ]
    for (let i = 0; i < lines.length; i++) {
      await new Promise((r) => setTimeout(r, 450))
      if (cancelled) return
      appendLog(lines[i], i === lines.length - 1 ? 'ready' : 'info')
    }
    if (!cancelled) status.value = 'ready'
    return
  }

  try {
    // 重放缓冲的历史日志（切换回日志页时能看到完整历史）。只执行一次。
    if (!historyReplayed) {
      historyReplayed = true
      try {
        const history = await window.api.getLogs()
        for (const line of history) appendLog(line, classifyLine(line))
      } catch {
        // 拉取失败不阻塞启动流程
      }
    }

    unlistenLog = window.api.onLog((text) => {
      appendLog(text, classifyLine(text))
    })
    unlistenState = window.api.onState((s) => {
      status.value = s
    })

    // 后端已在运行（比如从日志页切回）：直接显示“就绪”，不必再启动。
    try {
      const running = await window.api.backendStatus()
      if (running) {
        status.value = 'ready'
      } else {
        appendLog('正在启动 dsh 后端…', 'system')
        await window.api.backendStart()
      }
    } catch {
      appendLog('正在启动 dsh 后端…', 'system')
      await window.api.backendStart()
    }
  } catch (err) {
    status.value = 'error'
    appendLog(`[错误] ${errMessage(err)}`, 'error')
  }
}

onMounted(() => {
  window.addEventListener('hashchange', onHash)
  if (inElectron) {
    unlistenMax = window.api.onMaximized((m) => {
      maximized.value = m
    })
  }
  void boot()
  syncViewMode()
})

onUnmounted(() => {
  cancelled = true
  window.removeEventListener('hashchange', onHash)
  unlistenLog?.()
  unlistenState?.()
  unlistenMax?.()
})

function openApp(): void {
  window.location.hash = '#/app'
}

function openSettings(): void {
  window.location.hash = '#/settings'
}

function openLogs(): void {
  window.location.hash = '#/logs'
}

function reloadPage(): void {
  if (!inElectron) {
    window.location.reload()
    return
  }
  window.api.reloadPage().catch((err) => {
    status.value = 'error'
    appendLog(`[错误] 无法刷新页面：${errMessage(err)}`, 'error')
  })
}

function reloadBackend(): void {
  if (!inElectron) return
  // 重载会重启后端，切到日志页展示重启过程；就绪后自动回到聊天页。
  window.location.hash = '#/logs'
  appendLog('正在重新加载后端…', 'system')
  window.api.reloadProfile().catch((err) => {
    status.value = 'error'
    appendLog(`[错误] 无法重新加载后端：${errMessage(err)}`, 'error')
  })
}

function minimize(): void {
  void window.api.windowMinimize()
}

function maximize(): void {
  void window.api.windowMaximize()
}

function close(): void {
  void window.api.windowClose()
}
</script>

<template>
  <div
    class="flex h-dvh flex-col bg-gradient-to-b from-background to-muted/40"
    :class="route === 'app' && 'overflow-hidden'"
  >
    <!-- 常驻工具栏：充当无头窗口的自定义标题栏 -->
    <AppToolbar
      :route="route"
      :maximized="maximized"
      @open-app="openApp"
      @open-settings="openSettings"
      @open-logs="openLogs"
      @reload="reloadPage"
      @reload-backend="reloadBackend"
      @minimize="minimize"
      @maximize="maximize"
      @close="close"
    />
    <main
      v-if="route === 'logs' || route === 'settings'"
      class="flex min-h-0 flex-1 justify-center overflow-y-auto p-6"
    >
      <SettingsPage v-if="route === 'settings'" />
      <SplashPage v-else :logs="logs" :status="status" />
    </main>
    <!-- app 模式：内容区留空，由主进程的 WebContentsView 覆盖渲染后端界面 -->
    <div v-else class="min-h-0 flex-1" />
  </div>
</template>
