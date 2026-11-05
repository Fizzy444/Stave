// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let _ = std::fs::write(
            "D:\\Project\\Stave\\stave_panic.log",
            format!("PANIC: {:#?}", info),
        );
        eprintln!("PANIC: {:#?}", info);
    }));

    let _ = std::fs::write("D:\\Project\\Stave\\stave_debug.log", "1. main() entered\n");
    tauri_app_lib::run();
    let _ = std::fs::write(
        "D:\\Project\\Stave\\stave_debug.log",
        "2. tauri_app_lib::run() exited\n",
    );
}
