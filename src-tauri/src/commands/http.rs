//! HTTP 直连下载（绕过 webview CORS）

/// 字体等大文件下载：webview 的 fetch 受 CORS 约束（GitHub Releases 的最终
/// 下载域不带跨域头），桌面端经 Rust 直连官方源。返回原始字节（二进制 IPC）。
#[tauri::command]
pub async fn http_get_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    if !url.starts_with("https://") {
        return Err("仅支持 https 链接".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 300 * 1024 * 1024 {
        return Err("文件超过 300MB 上限".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}
