# DSH Desktop

A [Tauri v2](https://tauri.app) desktop shell that wraps the DeepSeek Harness web GUI in a native window, with a **system tray icon** for switching profiles.

On launch it:

1. Opens a window showing a **“启动中”** splash with a live log console.
2. Picks a **random free port** on `127.0.0.1`.
3. Runs `dsh --profile <default>` (hidden, no console) and streams its output into the splash log.
4. Navigates the window to the real URL once the server answers.

A tray icon (bottom-right) provides:

- **切换 Profile** — lists every profile under `$DSH_HOME/profiles` (e.g. `web`, `desktop`); picking one **restarts the backend** with that profile and re-navigates the window. The current profile is checked.
- **退出** — quits the app and stops the backend.

Closing the window also quits the app (and stops the backend).

## Prerequisites

- Node.js + pnpm
- Rust toolchain (https://rustup.rs)
- WebView2 (preinstalled on Windows 10/11)
- `dsh` available on PATH (global command)

## Quick start

```bash
# 1. install JS deps (frontend + Tauri CLI)
pnpm install

# 2. (re)generate icons from app-icon.png
pnpm icon

# 3. run in dev mode (Vite dev server :1420 + Tauri window)
pnpm dev

# 4. build installers (frontend build + release + bundle)
pnpm build
```

## Frontend (React + Vite + shadcn/ui)

- **Source** lives in `src/` (committed to git); `dist/` is the Vite build output (gitignored).
- **Stack**: React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (Base UI, `nova` preset).
- **Splash page**: `src/App.tsx` — listens for `backend-log` / `backend-state` events via `@tauri-apps/api`, then invokes the `backend_start` command. In a plain browser (no Tauri) it falls back to a mock boot so the UI can be iterated standalone: `pnpm dev:web`.
- **Adding components** (e.g. for future settings pages):

  ```bash
  pnpm dlx shadcn@latest add <component>   # e.g. input, switch, dialog, sheet
  ```

- Other scripts: `pnpm build:web` (frontend only), `pnpm typecheck` (tsc --noEmit), `pnpm preview`.

## How it works

- **Splash page**: React app in `src/` (built by Vite into `dist/`) — listens for `backend-log` / `backend-state` events via `@tauri-apps/api`, then invokes the `backend_start` command.
- **Backend lifecycle**: `src-tauri/src/lib.rs`
  - `scan_profiles()` — lists directories under `$DSH_HOME/profiles` (skips `node_modules` and dot-dirs).
  - `pick_free_port()` — binds `127.0.0.1:0` to get an OS-assigned free port.
  - `launch_backend()` — stops any running backend, spawns `dsh --profile <name> --host 127.0.0.1 --port <random>` through `cmd.exe` (the Volta `dsh.cmd` shim) with `CREATE_NO_WINDOW`, pipes stdout/stderr as logs, polls readiness, then navigates the window.
  - A generation counter prevents stale navigations during fast switches.
  - On exit (`RunEvent::Exit` or window close), `kill_tree()` runs `taskkill /PID … /T /F` to terminate the whole process tree (cmd → volta → node).
- **Tray**: created in `setup_tray` (`TrayIconBuilder` + a `Menu` with a dynamic `Submenu` of `CheckMenuItem`s).
- **Config**: `src-tauri/tauri.conf.json` — dev 时 `beforeDevCommand` 启动 Vite（:1420），build 时 `beforeBuildCommand` 先产前端，`frontendDist` 指向 `../dist`；窗口在 dev 指向 `devUrl`、生产指向打包后的 `dist`。

To change the bind host, edit `BACKEND_HOST` in `src-tauri/src/lib.rs`. The port is always chosen dynamically; profiles come from `$DSH_HOME/profiles`.
