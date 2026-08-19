fn main() {
    // Windows 的 .exe 图标由 tauri-build（tauri-winres）在 build 脚本里嵌入，
    // 默认不会因为 icons 目录变化而重跑，导致换图标后 exe 图标不更新。
    // 显式声明图标文件为依赖，确保图标变更时重新嵌入并重新链接。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
