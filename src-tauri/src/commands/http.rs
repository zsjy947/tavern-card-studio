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
    // 上限检查前置到读取阶段：先看 Content-Length，再流式累计——
    // 先 bytes() 整读再判长度的话，恶意源可在 300s 内灌入数 GB 撑爆内存
    const MAX_BYTES: usize = 300 * 1024 * 1024;
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_BYTES {
            return Err("文件超过 300MB 上限".into());
        }
    }
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(1024 * 1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if buf.len() + chunk.len() > MAX_BYTES {
            return Err("文件超过 300MB 上限".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(tauri::ipc::Response::new(buf))
}
