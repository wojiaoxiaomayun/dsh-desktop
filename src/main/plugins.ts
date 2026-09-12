import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { emitLog } from './state'
import { profileDir } from './profiles'

export interface PluginInfo {
  /** 包名（npm 作用域包 / 普通包） */
  name: string
  /** package.json dependencies 中记录的版本/来源 */
  version: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function readManifest(dir: string): ProfileManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as ProfileManifest
  } catch {
    return null
  }
}

/**
 * 当前 profile 下已安装并激活的插件 = package.json 的
 * dependencies ∩ dsh.profile.bundles（与 dsh CLI 的 reconcile 口径一致）。
 * 模板自带的核心 bundle（如 @deepseek-ai/dsh-base）不在 dependencies 中，因此不会出现。
 */
export function listPlugins(profile: string): PluginInfo[] {
  const dir = profileDir(profile)
  if (!existsSync(dir)) return []
  const manifest = readManifest(dir)
  if (!manifest) return []
  const deps = manifest.dependencies ?? {}
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  return Object.entries(deps)
    .filter(([name]) => bundles.has(name))
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

interface ExecResult {
  code: number
  output: string
}

/**
 * 运行 `dsh plugin --profile <name> <args...>`。dsh 会把它转发给 profile 目录下的 pnpm，
 * 并在成功后把声明了 dsh.bundle 的依赖 reconcile 进 bundles 层。Windows 走 cmd.exe（Volta shim）并隐藏窗口。
 */
function execPlugin(args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const cmd =
      process.platform === 'win32'
        ? spawn('cmd', ['/C', 'dsh', 'plugin', ...args], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        : spawn('dsh', ['plugin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })

    let out = ''
    const timer = setTimeout(() => {
      cmd.kill()
      reject(new Error('插件操作超时，请稍后重试'))
    }, timeoutMs)

    cmd.stdout?.on('data', (d) => (out += String(d)))
    cmd.stderr?.on('data', (d) => (out += String(d)))
    cmd.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    cmd.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output: out })
    })
  })
}

/** 提取命令输出末尾有意义的几行（pnpm 的报错/提示通常在尾部）。 */
function tail(output: string, lines = 4): string {
  const list = output
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (list.length === 0) return '(无输出)'
  return list.slice(-lines).join(' ')
}

/** 校验目标 profile 可被 dsh 管理（不存在或为保留名时给出明确错误）。 */
function assertManageable(profile: string): void {
  if (profile.toLowerCase() === 'desktop') {
    throw new Error('“desktop” 是保留的 Profile 名称，不支持插件管理')
  }
  if (!existsSync(profileDir(profile))) {
    throw new Error(`Profile “${profile}” 不存在`)
  }
}

/**
 * 校验一个插件 spec。允许 npm 包名、版本/标签/范围、作用域包、git / file / link 等常见 pnpm add 形式，
 * 但拒绝 shell 元字符（尤其 Windows cmd /C 拼接参数时会被重新解析，存在命令注入风险）。
 */
export function validatePluginSpec(spec: string): string | null {
  if (!spec) return '插件包名不能为空'
  if (spec.length > 200) return '插件 spec 过长'
  // 白名单：字母数字 + @ . / : # ~ ^ + = -（不允许空格，一次添加多个包请用空格分隔）
  if (/[^A-Za-z0-9@._/:~^+=#-]/.test(spec)) {
    return `“${spec}”含有不允许的字符（仅支持包名、版本、标签、git/file/link 形式）`
  }
  return null
}

/** 添加插件（可一次多个）。成功返回最新插件列表。 */
export async function addPlugins(profile: string, specs: string[]): Promise<PluginInfo[]> {
  assertManageable(profile)
  for (const s of specs) {
    const err = validatePluginSpec(s)
    if (err) throw new Error(err)
  }
  const res = await execPlugin(['--profile', profile, 'add', ...specs], 10 * 60_000)
  if (res.code !== 0) {
    throw new Error(`添加插件失败（退出码 ${res.code}）：${tail(res.output)}`)
  }
  emitLog(`[插件] 已向 Profile “${profile}” 添加：${specs.join('、')}`)
  if (/\bwarning|警告|未声明 dsh\.bundle/i.test(res.output)) {
    emitLog(`[插件] 提示：${tail(res.output)}`)
  }
  return listPlugins(profile)
}

/** 移除插件。成功返回最新插件列表。 */
export async function removePlugin(profile: string, name: string): Promise<PluginInfo[]> {
  assertManageable(profile)
  const err = validatePluginSpec(name)
  if (err) throw new Error(err)
  const res = await execPlugin(['--profile', profile, 'remove', name], 5 * 60_000)
  if (res.code !== 0) {
    throw new Error(`移除插件失败（退出码 ${res.code}）：${tail(res.output)}`)
  }
  emitLog(`[插件] 已从 Profile “${profile}” 移除：${name}`)
  return listPlugins(profile)
}
