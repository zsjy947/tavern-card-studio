//! 数据库连接串

/// 数据库连接串：便携优先。
/// tauri-plugin-sql 对相对路径按 AppConfig(AppData) 解析；要落 exe 同级 ./data
/// 必须给绝对路径。exe 同级 data/ 可写 → 便携；失败回退相对路径（AppData）。
#[tauri::command]
pub fn db_url() -> String {
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
