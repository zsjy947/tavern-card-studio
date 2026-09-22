use tauri::Manager;

/// 便携模式：exe 同级 ./data 可写则把工作目录切到 exe 目录，
/// SQLite（studio.db）即落在 ./data 下；失败则由 plugin-sql 回退 AppData。
fn setup_portable_data_dir(app: &tauri::App) {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    if let Some(dir) = exe_dir {
        let data = dir.join("data");
        if std::fs::create_dir_all(&data).is_ok() && dir.join("portable.flag").exists() {
            // portable.flag 存在 → 便携模式
            let _ = std::env::set_current_dir(&data);
        } else {
            // 默认仍尝试 exe 同级（绿色目录习惯），无权限时静默回退
            if std::fs::create_dir_all(&data).is_ok() {
                let _ = std::env::set_current_dir(&data);
            }
        }
    }
    let _ = app;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            setup_portable_data_dir(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
