import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { createServer } from 'net'
import { session, shell } from 'electron'
import {
  BACKEND_HOST,
  emitLog,
  emitState,
  flushBackendAuth,
  getBackendUrl,
  getBackendView,
  getCurrentProfile,
  getMainWindow,
  mountBackendView,
  navigateRenderer,
  reloadBackendView,
  showBackendView,
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

/** `--no-open` 支持情况缓存（极旧版 dsh 可能没有该参数）。null 表示尚未验证。 */
let noOpenSupported: boolean | null = null

/** 组装 dsh 启动参数并拉起子进程，登记状态、持久化 profile、转发日志流。 */
function spawnDsh(
  profile: string,
  port: number,
  gen: number,
  withNoOpen: boolean,
): ReturnType<typeof spawn> {
  const args = ['--profile', profile, '--host', BACKEND_HOST, '--port', String(port)]
  if (withNoOpen) args.push('--no-open')
  emitLog(`[启动] dsh ${args.join(' ')}`)
  const child = runDsh(args)
  state.pid = child.pid ?? 0
  state.profile = profile
  state.backendUrl = `http://${BACKEND_HOST}:${port}/`
  state.token = null
  saveProfile(profile)
  streamLogs(child.stdout, gen)
  streamLogs(child.stderr, gen)
  return child
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
  const m = line.match(/[?&]token=([A-Za-z0-9_-]+)/)
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

/** 后端根路径的探测结果。 */
type BackendProbe = 'down' | 'starting' | 'auth-required' | 'up'

/**
 * 等待启动日志打印访问 token 的上限。
 * token 行出现在整棵插件树就绪之后，profile 装的插件越多越晚；
 * 实测重 profile 的等待明显超过 1 秒的量级，这里给足余量。
 */
const TOKEN_WAIT_TIMEOUT_MS = 20_000

/**
 * 探测后端根路径的启动与鉴权状态。
 * `dsh web` 的 webserver 先绑定端口、web-runtime 稍后才挂上前端静态资源，
 * 这中间 `/` 返回 404 —— 不能当成“就绪”。真正可用的标志只有两种：
 * 401（需要 token，必须从启动日志里取）和 2xx（无需 token，可直接打开）。
 * @returns 'down' 端口未监听 / 'starting' 监听但前端未挂载 / 'auth-required' 需要 token / 'up' 可直接访问。
 */
async function probeBackend(port: number): Promise<BackendProbe> {
  try {
    const res = await fetch(`http://${BACKEND_HOST}:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    })
    if (res.status === 401) return 'auth-required'
    if (res.status === 404 || res.status >= 500) return 'starting'
    return 'up'
  } catch {
    return 'down'
  }
}

/** 把子进程输出逐行转发到窗口日志，并捕获其中打印的访问 token。 */
function streamLogs(stream: NodeJS.ReadableStream | null, gen: number): void {
  if (!stream) return
  const rl = createInterface({ input: stream })
  rl.on('line', (line) => {
    emitLog(line)
    const token = extractToken(line)
    if (token && state.generation === gen) {
      state.token = token
      // token 是插件树全部就绪后才打印的；若视图已经因为缺 token 落到 401 页，
      // 这里立刻带 token 重载，把空白页救回来。
      flushBackendAuth()
    }
  })
}

/**
 * 清理默认 session 中 127.0.0.1 / localhost 的 Cookie（含每次启动产生的 auth token）。
 * dsh 每次用随机端口重启，而 Cookie 不区分端口、只按域名累积，旧 token 一直保留，
 * 累积到一定程度会让请求头超过后端默认上限，导致 /plugins/?? 组合资源被 431 拒绝。
 * 只清本地后端域名的 cookie，不影响其他站点。
 */
async function clearLocalCookies(): Promise<void> {
  try {
    const ses = session.defaultSession
    const targets = ['http://127.0.0.1', 'https://127.0.0.1', 'http://localhost', 'https://localhost']
    let removed = 0
    for (const url of targets) {
      const list = await ses.cookies.get({ url })
      for (const c of list) {
        try {
          await ses.cookies.remove(url, c.name)
          removed += 1
        } catch {
          // 单个 cookie 删除失败不影响其他
        }
      }
    }
    if (removed > 0) {
      emitLog(`[清理] 已清除 ${removed} 个本地后端残留 Cookie（端口切换后 token 不再累积）`)
    }
  } catch (err) {
    emitLog(`[警告] 清理本地 Cookie 失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 统一的后端启动/重启逻辑：停旧 → 随机端口 → 拉起 dsh → 转发日志 → 就绪后导航。 */
async function launchBackend(profile: string): Promise<number> {
  stopCurrent()
  state.generation += 1
  const gen = state.generation

  // 每次切换端口前清理旧的本地认证 Cookie：Cookie 按域名（127.0.0.1 / localhost）
  // 存储、不区分端口，端口一换旧 token 不会自动失效，反复累积会撑爆请求头
  // （/plugins/?? 组合资源因此被 431 Request Header Fields Too Large 拒绝）。
  await clearLocalCookies()

  const port = await pickFreePort()
  const targetUrl = `http://${BACKEND_HOST}:${port}/`

  // 默认始终带上 --no-open：桌面端用内嵌 webview 展示界面，不应再弹系统浏览器。
  // 仅当 dsh 因不认识该参数在数秒内报错退出时，去掉参数重启一次并缓存该结果。
  const withNoOpen = noOpenSupported !== false
  let child = spawnDsh(profile, port, gen, withNoOpen)
  const startedAt = Date.now()
  let stderrTail = ''
  // 子进程是否已退出：退出后端口不会被监听，无需再等到 60 秒超时。
  let childExited = false
  child.stderr?.on('data', (d) => {
    stderrTail = `${stderrTail}${d}`.slice(-4000)
  })

  child.on('exit', () => {
    if (state.pid === child.pid) state.pid = null
    childExited = true
  })

  if (withNoOpen) {
    child.on('exit', (code) => {
      if (
        noOpenSupported !== false &&
        code !== null &&
        code !== 0 &&
        Date.now() - startedAt <= 8000 &&
        /unknown option|unknown argument|未知/i.test(stderrTail)
      ) {
        noOpenSupported = false
        emitLog('[警告] 当前 dsh 不支持 --no-open，已去掉该参数重新启动')
        // 同代且当前没有别的后端在跑时，才自动重启（快速切换/新启动交给新流程处理）
        if (state.generation === gen && state.pid === null) {
          child = spawnDsh(profile, port, gen, false)
          childExited = false
          child.stderr?.on('data', (d) => {
            stderrTail = `${stderrTail}${d}`.slice(-4000)
          })
          child.on('exit', () => {
            if (state.pid === child.pid) state.pid = null
            childExited = true
          })
        }
      }
    })
  }

  // 就绪轮询（代数计数防止快速切换时的旧导航）
  const deadline = Date.now() + 60_000
  const poll = async (): Promise<void> => {
    if (state.generation !== gen) return
    if (childExited) {
      // --no-open 兼容性重启可能正在路上，短暂让行后再判定
      await new Promise((r) => setTimeout(r, 500))
      if (state.generation !== gen) return
      if (childExited) {
        const detail = stderrTail.trim().split(/\r?\n/).slice(-3).join(' | ')
        emitLog(`[错误] dsh 进程已退出，后端未能启动${detail ? `：${detail}` : ''}`)
        emitState('error')
        return
      }
    }
    const probe = await probeBackend(port)
    if (probe === 'auth-required' || probe === 'up') {
      if (state.generation === gen) {
        // 需要 token 时一直等到启动日志打印出带 token 的地址为止：
        // 插件树越重、打印越晚，1 秒的固定等待会让视图以 401 空白页收场。
        const token =
          probe === 'auth-required' ? await waitForToken(TOKEN_WAIT_TIMEOUT_MS) : state.token
        if (state.generation !== gen) return
        if (probe === 'auth-required' && !token) {
          emitLog(
            `[警告] 等待 ${TOKEN_WAIT_TIMEOUT_MS / 1000} 秒仍未从启动日志中获取访问 token，` +
              '先以无 token 地址打开（视图若被拒会自动重试）',
          )
        }
        const url = token ? `${targetUrl}?token=${token}` : targetUrl
        emitLog(`[就绪] 后端已启动：${url}`)
        emitState('ready')
        // 后端就绪后自动进入聊天页：切到 app 模式并挂载显示后端视图。
        navigateRenderer('/app')
        mountBackendView(url)
        showBackendView()
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

  return state.pid ?? 0
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

/** 导航回后端界面：显示主窗口外壳，并把当前后端 URL 加载进内嵌视图。 */
export function navigateBackend(): void {
  const url = getBackendUrl()
  if (!url) throw new Error('后端尚未启动，暂无主界面可返回')
  const win = getMainWindow()
  if (!win) throw new Error('主窗口尚未创建')
  win.show()
  win.focus()
  navigateRenderer('/app')
  mountBackendView(url)
  showBackendView()
}

/** 刷新内嵌后端视图：客户端路由不变；认证 Cookie 失效时自动带 token 重新加载。 */
export async function reloadPage(): Promise<void> {
  await reloadBackendView()
}

/** 打开/关闭后端视图的 Web Inspector，返回切换后是否处于打开状态。 */
export function toggleDevtools(): boolean {
  const view = getBackendView()
  if (!view) throw new Error('后端视图尚未创建')
  const wc = view.webContents
  const open = wc.isDevToolsOpened()
  if (open) wc.closeDevTools()
  else wc.openDevTools()
  return !open
}

/** 打开后端视图的 Web Inspector（托盘“打开控制台”）。 */
export function openDevtools(): void {
  const view = getBackendView()
  if (!view) throw new Error('后端视图尚未创建')
  view.webContents.openDevTools()
}

/** 用系统默认浏览器打开后端视图当前页面（仅内部 http）；否则打开后端主界面地址。 */
export function openInBrowser(): void {
  const view = getBackendView()
  const current = view?.webContents.getURL()
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
