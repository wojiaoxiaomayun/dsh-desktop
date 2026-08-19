// Always use the Windows GUI subsystem so no console window appears (even in debug builds).
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    dsh_desktop_lib::run()
}
