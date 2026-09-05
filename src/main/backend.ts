import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { createServer } from 'net'
import { shell } from 'electron'
import {
  BACKEND_HOST,
  emitLog,
  emitState,
  getBackendUrl,
  getCurrentProfile,
  getMainWindow,
  navigateToUrl,
  state,
} from './state'
import { defaultProfile, saveProfile, scanProfiles } from './profiles'

/** 绑定 127.0.0.1:0 获取一个 OS 分配的空闲端口。 */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, BACKEND_HOST, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/** 运行 dsh 命令。Windows 上走 cmd.exe（Volta shim）并隐藏窗口。 */
function runDsh(args: string[]): ReturnType<typeof spawn> {
  if (process.platform === 'win32') {
    return spawn('cmd', ['/C', 'dsh', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  return spawn('dsh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

/** `--no-open` 支持情况的缓存（不同 dsh 版本可能没有该参数）。 */
let noOpenSupported: boolean | null = null

/** 探测当前 dsh 是否支持 `--no-open`（通过 `dsh --profile <name> --help` 的输出判断）。 */
function detectNoOpenSupport(profile: string): Promise<boolean> {
  if (noOpenSupported !== null) return Promise.resolve(noOpenSupported)
  return new Promise((resolve) => {
    const child = runDsh(['--profile', profile, '--help'])
    let out = ''
    let settled = false
    let timer: NodeJS.Timeout
    const finish = (v: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      noOpenSupported = v
      resolve(v)
    }
    timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, 8000)
    child.stdout?.on('data', (d) => {
      out += d.toString()
    })
    child.stderr?.on('data', (d) => {
      out += d.toString()
    })
    child.on('close', () => finish(out.includes('--no-open')))
    child.on('error', () => finish(false))
  })
}

/** 退出时回收后端进程树。 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // 进程已退出
    }
  }
}

function stopCurrent(): void {
  if (state.pid !== null) {
    killTree(state.pid)
    state.pid = null
  }
}

/** 从日志行中提取 token（新版 dsh 会打印形如 http://…/?token=… 的地址）。 */
function extractToken(line: string): string | null {
  const m = line.match(/[?&]token=([A-Za-z0-9_\-]+)/)
  return m ? m[1] : null
}

/** 等待 token 被日志流捕获（最多 timeoutMs），未捕获到则返回 null。 */
function waitForToken(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (state.token) {
      resolve(state.token)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      if (state.token) {
        clearInterval(timer)
        resolve(state.token)
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve(null)
      }
    }, 100)
  })
}

/** 后端是否就绪：向 / 发一个 GET，能收到 HTTP 响应即视为就绪。 */
async function backendReady(port: number): Promise<boolean> {
  const url = state.token
    ? `http://${BACKEND_HOST}:${port}/?token=${state.token}`
    : `http://${BACKEND_HOST}:${port}/`
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/** 把子进程输出逐行转发到窗口日志，并捕获其中打印的访问 token。 */
function streamLogs(stream: NodeJS.ReadableStream | null, gen: number): void {
  if (!stream) return
  const rl = createInterface({ input: stream })
  rl.on('line', (line) => {
    emitLog(line)
    const token = extractToken(line)
    if (token && state.generation === gen) state.token = token
  })
}

/** 统一的后端启动/重启逻辑：停旧 → 随机端口 → 拉起 dsh → 转发日志 → 就绪后导航。 */
async function launchBackend(profile: string): Promise<number> {
  stopCurrent()
  state.generation += 1
  const gen = state.generation

  const port = await pickFreePort()
  const targetUrl = `http://${BACKEND_HOST}:${port}/`

  const args = ['--profile', profile, '--host', BACKEND_HOST, '--port', String(port)]
  if (await detectNoOpenSupport(profile)) args.push('--no-open')
  const child = runDsh(args)
  const pid = child.pid ?? 0
  state.pid = pid
  state.profile = profile
  state.backendUrl = targetUrl
  state.token = null
  saveProfile(profile)

  streamLogs(child.stdout, gen)
  streamLogs(child.stderr, gen)

  child.on('exit', () => {
    if (state.pid === pid) state.pid = null
  })

  // 就绪轮询（代数计数防止快速切换时的旧导航）
  const deadline = Date.now() + 60_000
  const poll = async (): Promise<void> => {
    if (await backendReady(port)) {
      if (state.generation === gen) {
        // 就绪后给一点时间等待 token 行被捕获（新版 dsh 需要 token 才能打开页面）
        const token = await waitForToken(1000)
        const url = token ? `${targetUrl}?token=${token}` : targetUrl
        emitLog(`[就绪] 后端已启动：${url}`)
        emitState('ready')
        navigateToUrl(url)
      }
      return
    }
    if (Date.now() >= deadline) {
      emitLog('[错误] 等待后端启动超时（60 秒）')
      emitState('timeout')
      return
    }
    setTimeout(() => void poll(), 300)
  }
  void poll()

  return pid
}

/** 启动默认 profile（若已在运行则跳过）。 */
export async function backendStart(): Promise<void> {
  if (state.pid !== null) return
  const profile = state.profile || defaultProfile(scanProfiles())
  await launchBackend(profile)
}

/** 切换到指定 profile：停止当前后端并以新 profile 重启。 */
export async function switchProfile(name: string): Promise<void> {
  if (!scanProfiles().includes(name)) throw new Error(`Profile “${name}” 不存在`)
  await launchBackend(name)
}

/** 重新加载当前 profile：停旧进程 → 以相同 profile 重启。 */
export async function reloadCurrent(): Promise<void> {
  await launchBackend(getCurrentProfile())
}

/** 后端是否已在运行。 */
export function backendStatus(): boolean {
  return state.pid !== null
}

/** 导航主窗口回当前后端界面。 */
export function navigateBackend(): void {
  const url = getBackendUrl()
  if (!url) throw new Error('后端尚未启动，暂无主界面可返回')
  navigateToUrl(url)
}

/** 打开/关闭主窗口的 Web Inspector，返回切换后是否处于打开状态。 */
export function toggleDevtools(): boolean {
  const win = getMainWindow()
  if (!win) throw new Error('主窗口尚未创建')
  win.show()
  win.focus()
  const open = win.webContents.isDevToolsOpened()
  if (open) win.webContents.closeDevTools()
  else win.webContents.openDevTools()
  return !open
}

/** 打开主窗口的 Web Inspector（托盘“打开控制台”）。 */
export function openDevtools(): void {
  const win = getMainWindow()
  if (!win) throw new Error('主窗口尚未创建')
  win.show()
  win.focus()
  win.webContents.openDevTools()
}

/** 用系统默认浏览器打开主窗口当前页面（仅内部 http）；否则打开后端主界面地址。 */
export function openInBrowser(): void {
  const win = getMainWindow()
  const current = win?.webContents.getURL()
  let target: string | null = null
  if (current) {
    try {
      const u = new URL(current)
      if (
        (u.protocol === 'http:' || u.protocol === 'https:') &&
        (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
      ) {
        // 后端校验 token 后可能重定向去掉了 URL 里的 token，浏览器打开时补上
        if (!u.searchParams.has('token') && state.token) {
          u.searchParams.set('token', state.token)
        }
        target = u.toString()
      }
    } catch {
      target = null
    }
  }
  if (!target) {
    const url = getBackendUrl()
    if (!url) throw new Error('后端尚未启动，暂无可打开的页面')
    target = url
  }
  shell.openExternal(target)
}

/** 退出时回收后端进程树。 */
export function killAll(): void {
  stopCurrent()
}
