import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

/** $DSH_HOME 目录（默认 `~/.dsh`）。 */
export function dshHome(): string {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), '.dsh')
}

/** 记录最近一次启动/切换 profile 的文件路径。 */
function profileStatePath(): string {
  return join(dshHome(), 'dsh-desktop-profile')
}

/** 读取上次记录的 profile（若存在）。 */
function loadSavedProfile(): string | null {
  try {
    const s = readFileSync(profileStatePath(), 'utf8').trim()
    return s.length > 0 ? s : null
  } catch {
    return null
  }
}

/** 持久化当前选择的 profile，供下次启动默认使用。 */
export function saveProfile(profile: string): void {
  const path = profileStatePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, profile)
  } catch {
    // 写入失败不影响启动
  }
}

/** 扫描 $DSH_HOME/profiles 下的 profile 目录（排除 node_modules 与隐藏目录）。 */
export function scanProfiles(): string[] {
  const dir = join(dshHome(), 'profiles')
  let profiles: string[] = []
  try {
    profiles = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
  } catch {
    // 目录不存在时返回空列表
  }
  profiles.sort()
  return profiles
}

/** 默认 profile：优先上次记录的（若仍存在），其次 `web`，最后取第一个。 */
export function defaultProfile(profiles: string[]): string {
  const saved = loadSavedProfile()
  if (saved && profiles.includes(saved)) return saved
  if (profiles.includes('web')) return 'web'
  return profiles[0] ?? 'web'
}

/** 校验 profile 名称，非法时返回错误信息。 */
export function validateProfileName(name: string): string | null {
  if (!name) return 'Profile 名称不能为空'
  if (name.length > 32) return 'Profile 名称过长（最多 32 个字符）'
  if (name === 'node_modules' || name.startsWith('.')) return `“${name}”不是合法的 Profile 名称`
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Profile 名称只能包含字母、数字、- 和 _'
  return null
}

/** 写入一个新 profile 的目录骨架（与 web profile 同款模板，bundle 指向 web 应用）。 */
function writeProfileSkeleton(dir: string, name: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    `{\n  "name": "dsh-profile-${name}",\n  "private": true,\n  "dependencies": {},\n  "dsh": {\n    "profile": {\n      "bundles": [\n        "@deepseek-ai/dsh-base",\n        "@deepseek-ai/dsh-web-app"\n      ]\n    }\n  }\n}\n`,
  )
  writeFileSync(
    join(dir, 'cordis.yml'),
    '# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json\'s dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n',
  )
  writeFileSync(
    join(dir, 'cordis.patch.yml'),
    '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n',
  )
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
}

/** 新增一个 Profile：创建目录骨架，失败时清理目录并抛出。 */
export function createProfile(name: string): void {
  const dir = join(dshHome(), 'profiles', name)
  if (existsSync(dir)) throw new Error(`Profile “${name}” 已存在`)
  mkdirSync(dir, { recursive: true })
  try {
    writeProfileSkeleton(dir, name)
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}
