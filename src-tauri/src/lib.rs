use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::CheckMenuItem;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, WebviewWindowBuilder};
use tauri::{Emitter, Manager, Url, WebviewUrl};

const BACKEND_HOST: &str = "127.0.0.1";

/// 应用级状态：后端进程 PID、当前 profile、启动代数（防竞态）、profile 菜单项（用于勾选态）、日志缓冲、后端 URL、托盘句柄。
struct BackendState {
    pid: Mutex<Option<u32>>,
    profile: Mutex<String>,
    generation: Mutex<u64>,
    profile_items: Mutex<Vec<CheckMenuItem<tauri::Wry>>>,
    logs: Mutex<VecDeque<String>>,
    backend_url: Mutex<Option<String>>,
    tray: Mutex<Option<tauri::tray::TrayIcon<tauri::Wry>>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            pid: Mutex::new(None),
            profile: Mutex::new(String::new()),
            generation: Mutex::new(0),
            profile_items: Mutex::new(Vec::new()),
            logs: Mutex::new(VecDeque::new()),
            backend_url: Mutex::new(None),
            tray: Mutex::new(None),
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
        .invoke_handler(tauri::generate_handler![
            backend_start,
            get_logs,
            backend_status,
            navigate_backend,
            list_profiles,
            current_profile,
            create_profile,
            switch_profile
        ])
        .setup(setup)
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

/// 应用初始化：先创建主窗口（挂载外部链接拦截），再创建托盘。
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    create_main_window(app)?;
    setup_tray(app)
}

/// 创建主窗口。窗口不在 tauri.conf.json 里声明，而是放到这里，以便挂载
/// `on_navigation` / `on_new_window` 处理器，把外部链接交给默认浏览器打开。
fn create_main_window(app: &mut tauri::App) -> tauri::Result<()> {
    let nav_handle = app.handle().clone();
    let popup_handle = app.handle().clone();

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("DSH Desktop")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .center()
        .on_navigation(move |url| {
            // 启动页与本地后端允许正常导航；其余一律交给默认浏览器并取消导航。
            if is_internal_url(url) {
                true
            } else {
                open_external(&nav_handle, url);
                false
            }
        })
        .on_new_window(move |url, _features: NewWindowFeatures| {
            // window.open / target="_blank"：在默认浏览器打开，不在应用内新建窗口。
            open_external(&popup_handle, &url);
            NewWindowResponse::Deny
        })
        .build()?;

    Ok(())
}

/// 判定一个 URL 是否属于应用内部：Tauri 启动页协议 + 本地后端（127.0.0.1 / localhost）。
fn is_internal_url(url: &Url) -> bool {
    if url.scheme() == "tauri" {
        return true;
    }
    matches!(
        url.host_str(),
        Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost")
    )
}

/// 用系统默认浏览器打开一个外部 URL（仅 http/https/mailto/tel）。
fn open_external(app: &tauri::AppHandle, url: &Url) {
    match url.scheme() {
        "http" | "https" | "mailto" | "tel" => {
            if let Err(e) = open::that_detached(url.as_str()) {
                emit_log(app, format!("[错误] 无法在浏览器中打开 {url}: {e}"));
            }
        }
        _ => {}
    }
}

/// 创建系统托盘图标和右键菜单（切换 Profile + 退出）。
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::tray::TrayIconBuilder;

    let menu = build_tray_menu(app.handle())?;
    let tray = TrayIconBuilder::new()
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

    // 存一份句柄，便于新增 Profile 后动态刷新菜单
    *app.state::<BackendState>().tray.lock().unwrap() = Some(tray);

    Ok(())
}

/// 根据当前 profiles 构建托盘菜单（初始创建与动态刷新共用）。
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let profiles = scan_profiles();
    let current = get_current_profile(app);

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
    let logs = MenuItem::with_id(app, "logs", "查看日志", true, None::<&str>)?;
    let open_backend = MenuItem::with_id(app, "open-backend", "返回主界面", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &reload,
            &logs,
            &open_backend,
            &settings,
            &sep1,
            &switch,
            &sep2,
            &quit,
        ],
    )
}

/// 新增/删除 Profile 后重建托盘菜单。
fn refresh_tray_menu(app: &tauri::AppHandle) {
    let menu = match build_tray_menu(app) {
        Ok(m) => m,
        Err(e) => {
            emit_log(app, format!("[错误] 刷新托盘菜单失败：{e}"));
            return;
        }
    };
    let state = app.state::<BackendState>();
    let tray = state.tray.lock().unwrap();
    if let Some(tray) = tray.as_ref() {
        let _ = tray.set_menu(Some(menu));
    }
}

/// 当前使用的 profile（未设置时按保存记录/默认规则取一个）。
fn get_current_profile(app: &tauri::AppHandle) -> String {
    let state = app.state::<BackendState>();
    let mut p = state.profile.lock().unwrap();
    if p.is_empty() {
        *p = default_profile(&scan_profiles());
    }
    p.clone()
}

/// 托盘菜单点击分发。
fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    match id {
        "quit" => app.exit(0),
        "show" => show_main(app),
        "reload" => reload_current(app),
        "logs" => show_logs(app),
        "settings" => show_settings(app),
        "open-backend" => {
            if let Err(e) = navigate_to_backend(app) {
                emit_log(app, format!("[错误] 无法返回主界面：{e}"));
            }
        }
        _ => {
            if let Some(profile) = id.strip_prefix("profile:") {
                let _ = restart_backend(app, profile);
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

/// 导航回启动页（日志页）。dev 模式回到 Vite dev server，生产模式回到打包的启动页。
/// 启动页挂载时会通过 `get_logs` 重放缓冲的历史日志。
fn show_logs(app: &tauri::AppHandle) {
    let url = if tauri::is_dev() {
        app.config()
            .build
            .dev_url
            .clone()
            .unwrap_or_else(|| Url::parse("http://localhost:1420").expect("invalid dev url"))
    } else {
        Url::parse("tauri://localhost/index.html").expect("invalid app url")
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(url);
    }
}

/// 导航到设置页（SPA hash 路由 `#/settings`）。
fn show_settings(app: &tauri::AppHandle) {
    let url = if tauri::is_dev() {
        let base = app
            .config()
            .build
            .dev_url
            .clone()
            .unwrap_or_else(|| Url::parse("http://localhost:1420").expect("invalid dev url"));
        Url::parse(&format!("{}#/settings", base)).expect("invalid dev url")
    } else {
        Url::parse("tauri://localhost/index.html#/settings").expect("invalid app url")
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(url);
    }
}

/// 重新加载当前 profile：停旧进程 → 以相同 profile 重启 → 就绪后重新导航，达到“重启”效果。
fn reload_current(app: &tauri::AppHandle) {
    let profile = get_current_profile(app);
    let _ = restart_backend(app, &profile);
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
fn restart_backend(app: &tauri::AppHandle, profile: &str) -> Result<(), String> {
    if let Err(e) = launch_backend(app, profile) {
        emit_log(app, format!("[错误] {e}"));
        let _ = app.emit("backend-state", "error");
        return Err(e);
    }
    Ok(())
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
        *state.backend_url.lock().unwrap() = Some(target_url.clone());
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
                    emit_log(&app2, format!("[就绪] 后端已启动：{target_url}"));
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
                emit_log(&app2, "[错误] 等待后端启动超时（60 秒）".to_string());
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
                    emit_log(&app, text.to_string());
                }
                Err(_) => break,
            }
        }
    });
}

/// 把一条日志写入缓冲（最多 500 条）并广播给前端。
fn emit_log(app: &tauri::AppHandle, text: String) {
    let state = app.state::<BackendState>();
    if let Ok(mut logs) = state.logs.lock() {
        if logs.len() >= 500 {
            logs.pop_front();
        }
        logs.push_back(text.clone());
    }
    let _ = app.emit("backend-log", text);
}

/// 返回最近缓冲的后端日志（最多 500 条），供启动页切换回来时重放历史。
#[tauri::command]
fn get_logs(state: tauri::State<'_, BackendState>) -> Vec<String> {
    state
        .logs
        .lock()
        .map(|logs| logs.iter().cloned().collect())
        .unwrap_or_default()
}

/// 后端是否已在运行（供启动页回看时判断“返回主界面”是否可用）。
#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendState>) -> bool {
    state.pid.lock().map(|pid| pid.is_some()).unwrap_or(false)
}

/// 导航主窗口回当前后端界面（从日志页返回主界面）。
#[tauri::command]
fn navigate_backend(app: tauri::AppHandle) -> Result<(), String> {
    navigate_to_backend(&app)
}

/// 实际执行：取记录的 backend_url 并导航主窗口。
fn navigate_to_backend(app: &tauri::AppHandle) -> Result<(), String> {
    let url = app
        .state::<BackendState>()
        .backend_url
        .lock()
        .map(|u| u.clone())
        .unwrap_or(None)
        .ok_or_else(|| "后端尚未启动，暂无主界面可返回".to_string())?;
    if let Some(w) = app.get_webview_window("main") {
        w.navigate(Url::parse(&url).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 列出 $DSH_HOME/profiles 下所有 profile（供设置页展示）。
#[tauri::command]
fn list_profiles() -> Vec<String> {
    scan_profiles()
}

/// 当前正在使用（或默认将使用）的 profile 名。
#[tauri::command]
fn current_profile(app: tauri::AppHandle) -> String {
    get_current_profile(&app)
}

/// 校验 profile 名称：非空、仅字母数字 `-` `_`、非隐藏目录、非 node_modules。
fn validate_profile_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Profile 名称不能为空".to_string());
    }
    if name.len() > 32 {
        return Err("Profile 名称过长（最多 32 个字符）".to_string());
    }
    if name == "node_modules" || name.starts_with('.') {
        return Err(format!("“{name}”不是合法的 Profile 名称"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Profile 名称只能包含字母、数字、- 和 _".to_string());
    }
    Ok(())
}

/// 写入一个新 profile 的目录骨架（与 web profile 同款模板，bundle 指向 web 应用）。
fn write_profile_skeleton(dir: &std::path::Path, name: &str) -> Result<(), String> {
    let io_err = |what: String| move |e: std::io::Error| format!("写入 {what} 失败：{e}");

    std::fs::write(
        dir.join("package.json"),
        format!(
            "{{\n  \"name\": \"dsh-profile-{name}\",\n  \"private\": true,\n  \"dependencies\": {{}},\n  \"dsh\": {{\n    \"profile\": {{\n      \"bundles\": [\n        \"@deepseek-ai/dsh-base\",\n        \"@deepseek-ai/dsh-web-app\"\n      ]\n    }}\n  }}\n}}\n"
        ),
    )
    .map_err(io_err("package.json".to_string()))?;

    std::fs::write(
        dir.join("cordis.yml"),
        "# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n",
    )
    .map_err(io_err("cordis.yml".to_string()))?;

    std::fs::write(
        dir.join("cordis.patch.yml"),
        "# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n",
    )
    .map_err(io_err("cordis.patch.yml".to_string()))?;

    std::fs::write(
        dir.join("pnpm-workspace.yaml"),
        "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
    )
    .map_err(io_err("pnpm-workspace.yaml".to_string()))?;

    Ok(())
}

/// 新增一个 Profile（创建目录骨架并刷新托盘菜单，之后即可通过托盘/设置页切换启动）。
#[tauri::command]
fn create_profile(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    validate_profile_name(&name)?;

    let dir = std::path::Path::new(&dsh_home())
        .join("profiles")
        .join(&name);
    if dir.exists() {
        return Err(format!("Profile “{name}” 已存在"));
    }

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("创建 Profile 目录失败：{e}"))?;
    if let Err(e) = write_profile_skeleton(&dir, &name) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }

    emit_log(&app, format!("[info] 已创建 Profile “{name}”"));
    refresh_tray_menu(&app);
    Ok(())
}

/// 切换到指定 profile：停止当前后端并以新 profile 重启（就绪后自动导航到主界面）。
#[tauri::command]
fn switch_profile(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if !scan_profiles().iter().any(|p| *p == name) {
        return Err(format!("Profile “{name}” 不存在"));
    }
    restart_backend(&app, &name)
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
