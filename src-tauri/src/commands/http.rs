//! HTTP 直连下载（绕过 webview CORS）

use crate::commands::net::shared_client;

/// 字体等大文件下载：webview 的 fetch 受 CORS 约束（GitHub Releases 的最终
/// 下载域不带跨域头），桌面端经 Rust 直连官方源。返回原始字节（二进制 IPC）。
/// 共享连接池（net.rs），总超时挂在请求级（.timeout）。
#[tauri::command]
pub async fn http_get_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    if !url.starts_with("https://") {
        return Err("仅支持 https 链接".into());
    }
    let resp = shared_client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| e.to_string())?;
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
