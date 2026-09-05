<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
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

/** 基于 URL hash 的简单路由：#/settings → 设置页，其余 → 日志页。 */
const route = ref<'logs' | 'settings'>(
  window.location.hash.startsWith('#/settings') ? 'settings' : 'logs',
)

function onHash(): void {
  route.value = window.location.hash.startsWith('#/settings') ? 'settings' : 'logs'
}

const logs = ref<LogLine[]>([])
const status = ref<BackendStatus>('starting')
let idRef = 0

function appendLog(text: string, level: LogLevel = 'info'): void {
  idRef += 1
  logs.value = [...logs.value.slice(-499), { id: idRef, time: now(), text, level }]
}

let unlistenLog: (() => void) | undefined
let unlistenState: (() => void) | undefined
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
  void boot()
})

onUnmounted(() => {
  cancelled = true
  window.removeEventListener('hashchange', onHash)
  unlistenLog?.()
  unlistenState?.()
})

function handleReturn(): void {
  window.api.navigateBackend().catch((err) => {
    status.value = 'error'
    appendLog(`[错误] 无法返回主界面：${errMessage(err)}`, 'error')
  })
}

function openSettings(): void {
  window.location.hash = '#/settings'
}
</script>

<template>
  <div
    class="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-muted/40 p-6"
  >
    <SettingsPage v-if="route === 'settings'" />
    <SplashPage
      v-else
      :logs="logs"
      :status="status"
      :in-electron="inElectron"
      @return="handleReturn"
      @open-settings="openSettings"
    />
  </div>
</template>
