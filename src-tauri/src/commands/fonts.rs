//! 字体文件落盘管理（便携数据目录 data/fonts/）

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 解析字体目录（font_dir 与 dir 校验共用）：便携优先（exe 同级 data/fonts/，与 studio.db 同源），
/// 目录不可建时回退 AppData/fonts。
fn resolve_font_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let fonts = dir.join("data").join("fonts");
            if std::fs::create_dir_all(&fonts).is_ok() {
                return Ok(fonts);
            }
        }
    }
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    std::fs::create_dir_all(&fallback).map_err(|e| e.to_string())?;
    Ok(fallback)
}

/// dir 参数校验（TCS-R3-01）：必须与 Rust 侧解析出的字体目录完全一致——
/// 前端只应回传 font_dir() 的返回值；不一致即拒绝，防止借 dir 参数读写/删除任意目录。
fn ensure_font_dir(app: &tauri::AppHandle, dir: &str) -> Result<PathBuf, String> {
    let expected = resolve_font_dir(app)?;
    if Path::new(dir) != expected.as_path() {
        return Err(format!("非法字体目录：{dir}"));
    }
    Ok(PathBuf::from(dir))
}

/// 字体文件目录：便携优先（exe 同级 data/fonts/，与 studio.db 同源），
/// 目录不可建时回退 AppData/fonts。返回后前端会缓存，勿频繁调用。
#[tauri::command]
pub async fn font_dir(app: tauri::AppHandle) -> Result<String, String> {
    resolve_font_dir(&app).map(|p| p.to_string_lossy().into_owned())
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
pub async fn font_write(app: tauri::AppHandle, dir: String, name: String, b64: String) -> Result<(), String> {
    use base64::Engine as _;
    let dir_path = ensure_font_dir(&app, &dir)?;
    let safe = safe_font_name(&name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    let path: PathBuf = dir_path.join(safe);
    if !path.parent().map(|p| p == dir_path.as_path()).unwrap_or(false) {
        return Err("路径越界".into());
    }
    std::fs::write(&path, bytes).map_err(|e| format!("字体写入失败：{e}"))
}

/// 读取字体文件，返回原始字节（二进制 IPC）。
#[tauri::command]
pub async fn font_read(app: tauri::AppHandle, dir: String, name: String) -> Result<tauri::ipc::Response, String> {
    let dir_path = ensure_font_dir(&app, &dir)?;
    let safe = safe_font_name(&name)?;
    let bytes = std::fs::read(dir_path.join(safe)).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 删除字体文件（不存在视为成功）。
#[tauri::command]
pub async fn font_delete(app: tauri::AppHandle, dir: String, name: String) -> Result<(), String> {
    let dir_path = ensure_font_dir(&app, &dir)?;
    let safe = safe_font_name(&name)?;
    match std::fs::remove_file(dir_path.join(safe)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 轻量存在性检查（技术债 D4）：try_exists + 元数据大小，替代「为了验证可读性
/// 而把几十 MB 字体整读进内存」的 font_read 全量读。返回 Some(字节数) = 存在。
#[tauri::command]
pub async fn font_exists(dir: String, name: String) -> Result<Option<u64>, String> {
    let safe = safe_font_name(&name)?;
    let path = Path::new(&dir).join(safe);
    match tokio::fs::try_exists(&path).await {
        Ok(false) => Ok(None),
        Ok(true) => {
            let len = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?.len();
            Ok(Some(len))
        }
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

    #[tokio::test]
    async fn font_exists_reports_presence_and_size() {
        let dir = std::env::temp_dir().join(format!("tcs_font_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("test_font.ttf");
        std::fs::write(&file, b"12345").unwrap();

        let hit = super::font_exists(dir.to_string_lossy().into_owned(), "test_font.ttf".into()).await.unwrap();
        assert_eq!(hit, Some(5));

        let miss = super::font_exists(dir.to_string_lossy().into_owned(), "nope.ttf".into()).await.unwrap();
        assert_eq!(miss, None);

        let bad = super::font_exists(dir.to_string_lossy().into_owned(), "../escape.ttf".into()).await;
        assert!(bad.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
