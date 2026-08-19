use std::io::{BufRead, BufReader, Read};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::CheckMenuItem;
use tauri::{Emitter, Manager};

const BACKEND_HOST: &str = "127.0.0.1";

/// 应用级状态：后端进程 PID、当前 profile、启动代数（防竞态）、profile 菜单项（用于勾选态）。
struct BackendState {
    pid: Mutex<Option<u32>>,
    profile: Mutex<String>,
    generation: Mutex<u64>,
    profile_items: Mutex<Vec<CheckMenuItem<tauri::Wry>>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            pid: Mutex::new(None),
            profile: Mutex::new(String::new()),
            generation: Mutex::new(0),
            profile_items: Mutex::new(Vec::new()),
        }
    }
}

/// $DSH_HOME 目录（默认 `~/.dsh`）。
fn dsh_home() -> String {
    std::env::var("DSH_HOME").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
        format!("{home}/.dsh")
    })
}

/// 记录最近一次启动/切换 profile 的文件路径。
fn profile_state_path() -> std::path::PathBuf {
    std::path::Path::new(&dsh_home()).join("dsh-desktop-profile")
}

/// 读取上次记录的 profile（若存在）。
fn load_saved_profile() -> Option<String> {
    std::fs::read_to_string(profile_state_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 持久化当前选择的 profile，供下次启动默认使用。
fn save_profile(profile: &str) {
    let path = profile_state_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, profile);
}

/// 扫描 $DSH_HOME/profiles 下的 profile 目录（排除 node_modules 与隐藏目录）。
fn scan_profiles() -> Vec<String> {
    let dir = std::path::Path::new(&dsh_home()).join("profiles");

    let mut profiles = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir() && !name.starts_with('.') && name != "node_modules" {
                profiles.push(name);
            }
        }
    }
    profiles.sort();
    profiles
}

fn default_profile(profiles: &[String]) -> String {
    // 优先使用上次切换后记录的 profile；仅在它仍然存在时生效。
    if let Some(saved) = load_saved_profile() {
        if profiles.iter().any(|p| *p == saved) {
            return saved;
        }
    }
    if profiles.iter().any(|p| p == "web") {
        "web".to_string()
    } else {
        profiles.first().cloned().unwrap_or_else(|| "web".to_string())
    }
}

fn pick_free_port() -> Option<u16> {
    TcpListener::bind((BACKEND_HOST, 0))
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![backend_start])
        .setup(setup_tray)
        .on_menu_event(handle_menu_event)
        .on_window_event(|window, event| {
            // 关闭主窗口仅隐藏到托盘，不退出进程；退出由托盘菜单“退出”完成。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let pid = app.state::<BackendState>().pid.lock().ok().and_then(|g| *g);
                if let Some(pid) = pid {
                    kill_tree(pid);
                }
            }
        });
}

/// 创建系统托盘图标和右键菜单（切换 Profile + 退出）。
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::tray::TrayIconBuilder;

    let profiles = scan_profiles();
    let current = {
        let state = app.state::<BackendState>();
        let mut p = state.profile.lock().unwrap();
        if p.is_empty() {
            *p = default_profile(&profiles);
        }
        p.clone()
    };

    // 每个 profile 一个复选项，当前项打勾
    let checks: Vec<CheckMenuItem<tauri::Wry>> = profiles
        .iter()
        .map(|p| {
            CheckMenuItem::with_id(
                app,
                format!("profile:{p}"),
                p.as_str(),
                true,
                *p == current,
                None::<&str>,
            )
            .expect("failed to create profile menu item")
        })
        .collect();

    // 存一份，便于切换后刷新勾选状态
    *app.state::<BackendState>().profile_items.lock().unwrap() = checks.clone();

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = checks
        .iter()
        .map(|c| c as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();

    let switch = Submenu::with_items(app, "切换 Profile", true, &item_refs)?;
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &reload, &sep1, &switch, &sep2, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("no default window icon").clone())
        .tooltip("DSH Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            // 左键单击托盘图标：恢复显示主窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 托盘菜单点击分发。
fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    match id {
        "quit" => app.exit(0),
        "show" => show_main(app),
        "reload" => reload_current(app),
        _ => {
            if let Some(profile) = id.strip_prefix("profile:") {
                restart_backend(app, profile);
            }
        }
    }
}

/// 恢复并聚焦主窗口（从托盘隐藏后重新打开）。
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 重新加载当前 profile：停旧进程 → 以相同 profile 重启 → 就绪后重新导航，达到“重启”效果。
fn reload_current(app: &tauri::AppHandle) {
    let profile = {
        let state = app.state::<BackendState>();
        let mut p = state.profile.lock().unwrap();
        if p.is_empty() {
            *p = default_profile(&scan_profiles());
        }
        p.clone()
    };
    restart_backend(app, &profile);
}

/// 由启动页调用：启动默认 profile（若已在运行则跳过）。
#[tauri::command]
fn backend_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    if state.pid.lock().unwrap().is_some() {
        return Ok(());
    }

    let profile = {
        let mut p = state.profile.lock().unwrap();
        if p.is_empty() {
            *p = default_profile(&scan_profiles());
        }
        p.clone()
    };

    launch_backend(&app, &profile)?;
    Ok(())
}

/// 切换 profile：停止当前后端并以新 profile 重启。
fn restart_backend(app: &tauri::AppHandle, profile: &str) {
    if let Err(e) = launch_backend(app, profile) {
        let _ = app.emit("backend-log", format!("[错误] {e}"));
        let _ = app.emit("backend-state", "error");
    }
}

/// 统一的后端启动/重启逻辑：停旧 → 随机端口 → 拉起 dsh --profile <name> → 转发日志 → 就绪后导航。
fn launch_backend(app: &tauri::AppHandle, profile: &str) -> Result<u32, String> {
    stop_current(app);

    let gen = {
        let state = app.state::<BackendState>();
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };

    let port = pick_free_port().ok_or("无法获取空闲端口")?;
    let target_url = format!("http://{BACKEND_HOST}:{port}/");

    let mut child =
        spawn_backend(profile, port).map_err(|e| format!("无法启动 dsh --profile {profile}: {e}"))?;
    let pid = child.id();

    {
        let state = app.state::<BackendState>();
        *state.pid.lock().unwrap() = Some(pid);
        *state.profile.lock().unwrap() = profile.to_string();
    }
    // 记录本次启动/切换的 profile，下次启动默认使用它。
    save_profile(profile);

    if let Some(stdout) = child.stdout.take() {
        spawn_log_stream(stdout, app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_stream(stderr, app.clone());
    }

    let app2 = app.clone();
    let profile_owned = profile.to_string();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            if backend_ready(port) {
                // 仅当仍是本次启动时才跳转，避免快速切换时的旧导航
                let current = *app2.state::<BackendState>().generation.lock().unwrap();
                if current == gen {
                    let _ = app2.emit("backend-log", format!("[就绪] 后端已启动：{target_url}"));
                    let _ = app2.emit("backend-state", "ready");
                    if let Ok(u) = tauri::Url::parse(&target_url) {
                        if let Some(w) = app2.get_webview_window("main") {
                            let _ = w.navigate(u);
                        }
                    }
                    update_checked(&app2, &profile_owned);
                }
                return;
            }
            if Instant::now() >= deadline {
                let _ = app2.emit("backend-log", "[错误] 等待后端启动超时（60 秒）");
                let _ = app2.emit("backend-state", "timeout");
                return;
            }
            thread::sleep(Duration::from_millis(300));
        }
    });

    Ok(pid)
}

fn stop_current(app: &tauri::AppHandle) {
    let pid = app.state::<BackendState>().pid.lock().ok().and_then(|g| *g);
    if let Some(pid) = pid {
        kill_tree(pid);
        *app.state::<BackendState>().pid.lock().unwrap() = None;
    }
}

fn update_checked(app: &tauri::AppHandle, profile: &str) {
    let target = format!("profile:{profile}");
    let state = app.state::<BackendState>();
    let items = state.profile_items.lock().unwrap();
    for item in items.iter() {
        let is_current = item.id().0.as_str() == target.as_str();
        let _ = item.set_checked(is_current);
    }
}

/// 把子进程输出逐行转发到窗口日志。
fn spawn_log_stream<R: Read + Send + 'static>(reader: R, app: tauri::AppHandle) {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.split(b'\n') {
            match line {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    let text = text.trim_end_matches('\r');
                    let _ = app.emit("backend-log", text.to_string());
                }
                Err(_) => break,
            }
        }
    });
}

/// 后端是否就绪：向 / 发一个 GET，能收到 HTTP 响应即视为就绪。
fn backend_ready(port: u16) -> bool {
    use std::io::Write;

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

    let req = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 512];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).contains("HTTP/"),
        _ => false,
    }
}

/// 启动 `dsh --profile <name>`。Windows 上 dsh 是 Volta 的 dsh.cmd shim，必须走 cmd.exe；
/// 并用 CREATE_NO_WINDOW 避免弹出终端。stdout/stderr 用管道捕获作为日志。
#[cfg(target_os = "windows")]
fn spawn_backend(profile: &str, port: u16) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    Command::new("cmd")
        .arg("/C")
        .arg("dsh")
        .arg("--profile")
        .arg(profile)
        .arg("--host")
        .arg(BACKEND_HOST)
        .arg("--port")
        .arg(port.to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

#[cfg(not(target_os = "windows"))]
fn spawn_backend(profile: &str, port: u16) -> std::io::Result<Child> {
    Command::new("dsh")
        .arg("--profile")
        .arg(profile)
        .arg("--host")
        .arg(BACKEND_HOST)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// 退出时回收后端进程树。
#[cfg(target_os = "windows")]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let _ = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(target_os = "windows"))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}
