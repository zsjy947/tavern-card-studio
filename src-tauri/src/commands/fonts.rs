//! 字体文件落盘管理（便携数据目录 data/fonts/）

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 字体文件目录：便携优先（exe 同级 data/fonts/，与 studio.db 同源），
/// 目录不可建时回退 AppData/fonts。返回后前端会缓存，勿频繁调用。
#[tauri::command]
pub async fn font_dir(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let fonts = dir.join("data").join("fonts");
            if std::fs::create_dir_all(&fonts).is_ok() {
                return Ok(fonts.to_string_lossy().into_owned());
            }
        }
    }
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    std::fs::create_dir_all(&fallback).map_err(|e| e.to_string())?;
    Ok(fallback.to_string_lossy().into_owned())
}

/// 字体文件名校验：仅允许平铺文件名（字母数字 . _ -），拒绝路径分隔与 ..。
pub fn safe_font_name(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(name.to_string())
    } else {
        Err(format!("非法字体文件名：{name}"))
    }
}

/// 写入字体文件（base64 传参：与卡封面同机制的 JSON IPC，一次性安装可接受）。
#[tauri::command]
pub async fn font_write(dir: String, name: String, b64: String) -> Result<(), String> {
    use base64::Engine as _;
    let safe = safe_font_name(&name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    let path: PathBuf = Path::new(&dir).join(safe);
    if !path.parent().map(|p| p == Path::new(&dir)).unwrap_or(false) {
        return Err("路径越界".into());
    }
    std::fs::write(&path, bytes).map_err(|e| format!("字体写入失败：{e}"))
}

/// 读取字体文件，返回原始字节（二进制 IPC）。
#[tauri::command]
pub async fn font_read(dir: String, name: String) -> Result<tauri::ipc::Response, String> {
    let safe = safe_font_name(&name)?;
    let bytes = std::fs::read(Path::new(&dir).join(safe)).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 删除字体文件（不存在视为成功）。
#[tauri::command]
pub async fn font_delete(dir: String, name: String) -> Result<(), String> {
    let safe = safe_font_name(&name)?;
    match std::fs::remove_file(Path::new(&dir).join(safe)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::safe_font_name;

    #[test]
    fn safe_font_name_accepts_flat_names() {
        assert!(safe_font_name("a.ttf").is_ok());
        assert!(safe_font_name("lxgw-wenkai_v1.520.woff2").is_ok());
        assert!(safe_font_name("local_ab12cd34.ttf").is_ok());
    }

    #[test]
    fn safe_font_name_rejects_paths_and_tricks() {
        assert!(safe_font_name("").is_err());
        assert!(safe_font_name("a/b.ttf").is_err());
        assert!(safe_font_name("a\\b.ttf").is_err());
        assert!(safe_font_name("..").is_err());
        assert!(safe_font_name("a..b.ttf").is_err());
        assert!(safe_font_name(".hidden").is_ok()); // 点开头合法但无分隔，可接受
    }
}
