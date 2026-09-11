# dsh-desktop-electron

An Electron application with Vue and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

### 发布新版本（自动更新）

更新源为 GitHub Releases，配置见 `electron-builder.yml` 的 `publish`（owner `wojiaoxiaomayun` / repo `dsh-desktop`）。

```bash
# 1. 提升 package.json 里的 version（客户端据此判断是否有新版本）
# 2. 带上具备 repo 权限的 GitHub Token 打包并发布
$ set GH_TOKEN=github_pat_xxx   # PowerShell: $env:GH_TOKEN = "github_pat_xxx"
$ pnpm release:win              # macOS 用 release:mac，Linux 用 release:linux
```

electron-builder 会自动创建 `v{version}` 的 Release 并上传安装包与 `latest.yml`（更新清单）。

客户端行为：启动 8 秒后静默检查一次 → 发现新版本自动后台下载 → 下载完成后弹出系统通知，并在「设置 → 软件更新」提供「重启并安装」。开发模式（`pnpm dev`）不检查更新。

### 检查 dsh 版本

「设置 → dsh 版本」会显示本机 `dsh --version` 的版本号，并可一键通过 npm 查询最新版本：

- 优先请求 npm registry（`https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags` 的 `latest` 标签）；
- registry 不可用时退回本机命令 `npm view @deepseek-ai/dsh@latest version`（兼容代理/镜像环境）；
- 本机版本落后时展示升级命令 `npm i -g @deepseek-ai/dsh@latest`，升级后重启应用生效。
