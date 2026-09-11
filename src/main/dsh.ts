import { spawn } from 'child_process'
import { ipcMain } from 'electron'
import { emitLog } from './state'

/** dsh CLI 在 npm 上的包名。 */
export const DSH_PACKAGE = '@deepseek-ai/dsh'

/** npm registry 的 dist-tags 接口（返回 { latest, next, alpha, … }）。 */
const DIST_TAGS_URL = `https://registry.npmjs.org/-/package/${DSH_PACKAGE}/dist-tags`

/** dsh 版本检查阶段。 */
export type DshVersionStatus = 'unknown' | 'checking' | 'latest' | 'outdated' | 'ahead' | 'error'

/** dsh 版本状态快照（本机版本 + npm 最新版本）。 */
export interface DshVersionState {
  /** 本机安装的 dsh 版本；未检测到为 null */
  current: string | null
  /** npm 上的最新版本；尚未检查为 null */
  latest: string | null
  status: DshVersionStatus
  /** 最近一次检查的时间戳（ms） */
  checkedAt: number | null
  error: string | null
}

let state: DshVersionState = {
  current: null,
  latest: null,
  status: 'unknown',
  checkedAt: null,
  error: null
}

/** 版本检查进行中标记，避免重复请求。 */
let checking = false

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 运行命令并返回 stdout/stderr 合并文本；Windows 上统一经 cmd.exe（dsh / npm 都是 .cmd shim）。 */
function exec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/C', cmd, ...args], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        : spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${cmd} 执行超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)

    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (out += String(d)))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(out)
        return
      }
      const tail = out.trim().split('\n')[0]?.trim()
      reject(new Error(`${cmd} 退出码 ${code}${tail ? `：${tail}` : ''}`))
    })
  })
}

/** 从命令输出里抓第一个形如 1.2.3 / 1.2.3-rc.1 的版本号。 */
function extractVersion(text: string): string | null {
  const m = text.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/)
  return m ? m[0] : null
}

/** 解析版本号：主版本号数组 + 预发布标识数组（无预发布时为空数组）。 */
function parseVersion(v: string): { main: number[]; pre: string[] } | null {
  const m = v.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { main: m[1].split('.').map(Number), pre: m[2] ? m[2].split('.') : [] }
}

/**
 * 比较两个版本号（含预发布规则：正式版 > 预发布，数字标识符 < 字母标识符）。
 * a > b 返回 1，a < b 返回 -1，相等返回 0，无法解析返回 null。
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null

  const len = Math.max(pa.main.length, pb.main.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (pa.main[i] ?? 0) - (pb.main[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1

  const preLen = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < preLen; i += 1) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff > 0 ? 1 : -1
      continue
    }
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 读取本机 `dsh --version`（成功一次后缓存，force 时强制重新读取）。 */
async function readCurrentVersion(force = false): Promise<string> {
  if (!force && state.current) return state.current
  const out = await exec('dsh', ['--version'], 15_000)
  const version = extractVersion(out)
  if (!version) throw new Error(`无法从 dsh 输出中解析版本号：${out.trim() || '(空输出)'}`)
  return version
}

/** 查询 npm 上的最新版本：优先直连 registry，失败时退回本机 npm 命令（兼容代理/镜像环境）。 */
async function fetchLatestVersion(): Promise<{ version: string; source: 'registry' | 'npm' }> {
  try {
    const res = await fetch(DIST_TAGS_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const tags = (await res.json()) as { latest?: string }
    if (!tags.latest) throw new Error('registry 未返回 latest 标签')
    return { version: tags.latest, source: 'registry' }
  } catch (registryErr) {
    try {
      const out = await exec('npm', ['view', `${DSH_PACKAGE}@latest`, 'version'], 20_000)
      const version = extractVersion(out)
      if (!version) throw new Error(`无法从 npm 输出中解析版本号：${out.trim() || '(空输出)'}`)
      return { version, source: 'npm' }
    } catch (npmErr) {
      throw new Error(
        `registry 查询失败（${msg(registryErr)}）；本机 npm 查询失败（${msg(npmErr)}）`
      )
    }
  }
}

/** 由本机/最新版本推导检查结果状态。 */
function computeStatus(current: string | null, latest: string | null): DshVersionStatus {
  if (!current || !latest) return 'unknown'
  const cmp = compareVersions(current, latest)
  if (cmp === null) return 'unknown'
  if (cmp === 0) return 'latest'
  return cmp < 0 ? 'outdated' : 'ahead'
}

/** 读取本机 dsh 版本并按需写回状态；失败时状态转为 error。 */
async function refreshCurrent(force = false): Promise<void> {
  try {
    const current = await readCurrentVersion(force)
    state = { ...state, current, status: computeStatus(current, state.latest), error: null }
  } catch (err) {
    state = { ...state, current: null, status: 'error', error: `未检测到本机 dsh：${msg(err)}` }
  }
}

/** 当前 dsh 版本状态：首次调用会读取本机版本（不联网）。 */
export async function dshVersionState(): Promise<DshVersionState> {
  if (!state.current && state.status !== 'checking') await refreshCurrent()
  return { ...state }
}

/** 通过 npm 检查 dsh 最新版本，并与本机版本比较。 */
export async function checkDshLatest(): Promise<DshVersionState> {
  if (checking) return { ...state }
  checking = true
  state = { ...state, status: 'checking', error: null }

  try {
    await refreshCurrent(true)
    emitLog(`[dsh] 正在通过 npm 查询 ${DSH_PACKAGE} 最新版本…`)

    const { version, source } = await fetchLatestVersion()
    const current = state.current
    const status = computeStatus(current, version)

    const tip = !current
      ? '（未检测到本机 dsh，仅显示 npm 版本）'
      : status === 'latest'
        ? '（已是最新）'
        : status === 'outdated'
          ? `（本机 v${current} 可升级）`
          : status === 'ahead'
            ? `（本机 v${current} 更新）`
            : '（无法比较版本号）'

    state = {
      ...state,
      latest: version,
      status,
      checkedAt: Date.now(),
      error: current ? null : '未检测到本机 dsh，仅显示 npm 上的最新版本'
    }
    emitLog(`[dsh] npm 最新版本 v${version}（来源：${source}）${tip}`)
  } catch (err) {
    const text = msg(err)
    state = { ...state, status: 'error', checkedAt: Date.now(), error: text }
    emitLog(`[dsh] 检查最新版本失败：${text}`)
  } finally {
    checking = false
  }

  return { ...state }
}

/** 注册 dsh 版本相关 IPC。 */
export function registerDshVersionIpc(): void {
  ipcMain.handle('dsh-version', () => dshVersionState())
  ipcMain.handle('dsh-check-latest', () => checkDshLatest())
}
