use tauri::Manager;

/// 数据库连接串：便携优先。
/// tauri-plugin-sql 对相对路径按 AppConfig(AppData) 解析；要落 exe 同级 ./data
/// 必须给绝对路径。exe 同级 data/ 可写 → 便携；失败回退相对路径（AppData）。
#[tauri::command]
fn db_url() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let data = dir.join("data");
            if std::fs::create_dir_all(&data).is_ok() {
                if let Ok(s) = data.join("studio.db").into_os_string().into_string() {
                    return format!("sqlite:{s}");
                }
            }
        }
    }
    "sqlite:studio.db".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![db_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
