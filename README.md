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
# 1. install JS deps (Tauri CLI)
pnpm install

# 2. (re)generate icons from app-icon.png
pnpm icon

# 3. run in dev mode
pnpm dev

# 4. build installers
pnpm build
```

## How it works

- **Splash page**: `dist/index.html` — listens for `backend-log` / `backend-state` events via `window.__TAURI__`, then invokes the `backend_start` command.
- **Backend lifecycle**: `src-tauri/src/lib.rs`
  - `scan_profiles()` — lists directories under `$DSH_HOME/profiles` (skips `node_modules` and dot-dirs).
  - `pick_free_port()` — binds `127.0.0.1:0` to get an OS-assigned free port.
  - `launch_backend()` — stops any running backend, spawns `dsh --profile <name> --host 127.0.0.1 --port <random>` through `cmd.exe` (the Volta `dsh.cmd` shim) with `CREATE_NO_WINDOW`, pipes stdout/stderr as logs, polls readiness, then navigates the window.
  - A generation counter prevents stale navigations during fast switches.
  - On exit (`RunEvent::Exit` or window close), `kill_tree()` runs `taskkill /PID … /T /F` to terminate the whole process tree (cmd → volta → node).
- **Tray**: created in `setup_tray` (`TrayIconBuilder` + a `Menu` with a dynamic `Submenu` of `CheckMenuItem`s).
- **Config**: `src-tauri/tauri.conf.json` — `withGlobalTauri` injects `window.__TAURI__`; the window starts on the local splash (`index.html`).

To change the bind host, edit `BACKEND_HOST` in `src-tauri/src/lib.rs`. The port is always chosen dynamically; profiles come from `$DSH_HOME/profiles`.
