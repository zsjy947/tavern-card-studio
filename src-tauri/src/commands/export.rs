//! 导出目录管理与文件落盘（全局导出目录，默认 exe 同级 data/exports/）

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 进程内已注册的导出目录（TCS-R3-01）：write_export 只写已注册目录。
/// 前端导出前先 set_export_dir（值来自 export_dir / pick_export_dir 的返回），
/// write_export 校验 dir 与注册值一致，防止 dir 被篡改后写任意位置。
static REGISTERED_EXPORT_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 注册导出目录：仅接受绝对路径、且当前存在并确实是文件夹的路径。
#[tauri::command]
pub async fn set_export_dir(dir: String) -> Result<(), String> {
    let p = PathBuf::from(&dir);
    if !p.is_absolute() {
        return Err(format!("导出目录必须为绝对路径：{dir}"));
    }
    let meta = std::fs::metadata(&p).map_err(|e| format!("导出目录不可访问：{e}"))?;
    if !meta.is_dir() {
        return Err(format!("导出目录不是文件夹：{dir}"));
    }
    *REGISTERED_EXPORT_DIR
        .lock()
        .map_err(|e| format!("导出目录状态锁异常：{e}"))? = Some(p);
    Ok(())
}

/// 取已注册目录并校验调用方传入的 dir 与之一致（未注册/不符都拒绝）。
fn registered_export_dir(dir: &str) -> Result<PathBuf, String> {
    let guard = REGISTERED_EXPORT_DIR.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(p) if Path::new(dir) == p.as_path() => Ok(p.clone()),
        Some(_) => Err(format!("导出目录与已注册值不符：{dir}（请先 set_export_dir）")),
        None => Err("导出目录未注册（请先 set_export_dir）".into()),
    }
}

/// 导出目录：便携优先（exe 同级 data/exports/，与 studio.db 同源），
/// 目录不可建时回退 AppData/exports。目录不存在时自动创建。
#[tauri::command]
pub async fn export_dir(app: tauri::AppHandle) -> Result<String, String> {
    ensure_export_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

fn ensure_export_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let exports = dir.join("data").join("exports");
            if std::fs::create_dir_all(&exports).is_ok() {
                return Ok(exports);
            }
        }
    }
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("exports");
    std::fs::create_dir_all(&fallback).map_err(|e| e.to_string())?;
    Ok(fallback)
}

/// 文件夹选择对话框（起始目录 start_dir 可空）。返回用户选择；取消返回 None。
#[tauri::command]
pub async fn pick_export_dir(
    app: tauri::AppHandle,
    start_dir: Option<String>,
) -> Result<Option<String>, String> {
    // blocking 对话框放 blocking 线程，避免卡 async runtime 与主线程
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut builder = handle.dialog().file().set_title("选择导出文件夹");
        if let Some(dir) = &start_dir {
            if Path::new(dir).is_dir() {
                builder = builder.set_directory(dir);
            }
        }
        match builder.blocking_pick_folder() {
            Some(fp) => fp
                .into_path()
                .map(|p| Some(p.to_string_lossy().into_owned()))
                .map_err(|e| e.to_string()),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("对话框任务失败：{e}"))?
}

/// 导出文件名清洗：拒绝路径分隔符、Windows 保留字符与设备名、控制字符；
/// 保留中文等 Unicode 字符。末尾的空格/点去除（Windows 语义）。
pub fn safe_export_file_name(name: &str) -> Result<String, String> {
    let bad: Vec<char> = name
        .chars()
        .filter(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
        .collect();
    if !bad.is_empty() {
        return Err(format!("文件名含非法字符：{}", bad.iter().collect::<String>()));
    }
    let trimmed = name.trim().trim_end_matches(['.', ' ']).trim();
    if trimmed.is_empty() || trimmed.starts_with('.') {
        return Err(format!("非法导出文件名：{name}"));
    }
    if trimmed.len() > 200 {
        return Err("文件名过长（>200 字节）".into());
    }
    let upper = trimmed.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let stem = upper.split('.').next().unwrap_or("");
    let is_com = stem.starts_with("COM") && stem[3..].chars().all(|c| c.is_ascii_digit());
    let is_lpt = stem.starts_with("LPT") && stem[3..].chars().all(|c| c.is_ascii_digit());
    if reserved.contains(&stem) || ((is_com || is_lpt) && stem.len() > 3 && stem.len() <= 5) {
        return Err(format!("文件名使用了 Windows 保留设备名：{stem}"));
    }
    Ok(trimmed.to_string())
}

/// 写出导出文件（base64 传参，与 font_write 同机制）。返回完整路径。
/// dir 必须与进程内已注册的导出目录一致（前端导出前先 set_export_dir，TCS-R3-01）。
#[tauri::command]
pub async fn write_export(dir: String, file_name: String, b64: String) -> Result<String, String> {
    use base64::Engine as _;
    let safe = safe_export_file_name(&file_name)?;
    let dir_path = registered_export_dir(&dir)?;
    std::fs::create_dir_all(&dir_path).map_err(|e| format!("导出目录不可用：{e}"))?;
    let path = dir_path.join(&safe);
    if path.parent() != Some(dir_path.as_path()) {
        return Err("路径越界".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入失败：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 在系统文件管理器中打开目录。
#[tauri::command]
pub async fn open_dir(dir: String) -> Result<(), String> {
    if !Path::new(&dir).is_dir() {
        return Err("目录不存在".into());
    }
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_export_file_name;

    #[test]
    fn accepts_common_and_unicode_names() {
        assert!(safe_export_file_name("card.json").is_ok());
        assert!(safe_export_file_name("林婉_v1.png").is_ok());
        assert!(safe_export_file_name("TavernCard Studio_0.1.0_x64-setup.exe").is_ok());
        assert!(safe_export_file_name("cards-20260926.zip ").is_ok()); // 尾空格去除
    }

    #[test]
    fn rejects_separators_and_reserved() {
        assert!(safe_export_file_name("a/b.png").is_err());
        assert!(safe_export_file_name("a\\b.png").is_err());
        assert!(safe_export_file_name("a:b.png").is_err());
        assert!(safe_export_file_name("a?b*\"<c>|.png").is_err());
        assert!(safe_export_file_name("").is_err());
        assert!(safe_export_file_name("   ").is_err());
        assert!(safe_export_file_name("..").is_err());
        assert!(safe_export_file_name(".hidden").is_err());
        assert!(safe_export_file_name("CON").is_err());
        assert!(safe_export_file_name("com1.txt").is_err());
        assert!(safe_export_file_name("lpt9.zip").is_err());
        // COM + 非数字不是保留名
        assert!(safe_export_file_name("company.txt").is_ok());
    }
}
