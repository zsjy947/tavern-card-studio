//! LLM 流式代理：桌面端绕过 webview fetch 的 CORS/连接复用限制，
//! SSE 逐块经 Channel 回传，JS 侧合成 ReadableStream Response。
//! 取消：llm_cancel_stream(session_id) 断开底层连接。

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine as _;
use futures::channel::oneshot;
use futures::future::{select, Either};
use futures::StreamExt;
use tauri::ipc::Channel;

/// 进行中的流式会话：session_id → 取消信号发送端
#[derive(Default)]
pub struct StreamRegistry(Mutex<HashMap<String, oneshot::Sender<()>>>);

impl StreamRegistry {
    fn register(&self, session_id: String, tx: oneshot::Sender<()>) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(session_id, tx);
        }
    }

    fn cancel(&self, session_id: &str) -> bool {
        if let Ok(mut map) = self.0.lock() {
            if let Some(tx) = map.remove(session_id) {
                let _ = tx.send(());
                return true;
            }
        }
        false
    }
}

/// Channel 事件（JSON 序列化，tag=事件类型）
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum StreamEvent {
    /// 响应头就绪（status/contentType 先行通知，JS 侧据此构造 Response）
    Headers { status: u16, content_type: String },
    /// 数据块（base64；SSE 文本也按字节传，保持任意 content-type 兼容）
    Chunk { bytes_b64: String },
    Done,
    Error { message: String },
}

/// 允许的目标：https 任意；http 仅限本机回环（本地网关如 Ollama/LM Studio）
fn validate_url(url: &str) -> Result<(), String> {
    let ok = url.starts_with("https://")
        || url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("http://[::1]");
    if ok {
        Ok(())
    } else {
        Err("仅支持 https 或本机回环地址".into())
    }
}

/// 流式 POST：headers 由前端传入（authorization 等），body 为完整请求体字符串。
/// 事件序：Headers → Chunk* → Done | Error。取消经 llm_cancel_stream。
#[tauri::command]
pub async fn llm_post_stream(
    state: tauri::State<'_, StreamRegistry>,
    url: String,
    headers: HashMap<String, String>,
    body: String,
    session_id: String,
    on_chunk: Channel<StreamEvent>,
) -> Result<(), String> {
    validate_url(&url)?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url).header("content-type", "application/json");
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.body(body).send().await.map_err(|e| format!("连接失败：{e}"))?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let _ = on_chunk.send(StreamEvent::Headers { status, content_type });

    let (tx, rx) = oneshot::channel::<()>();
    state.register(session_id, tx);

    let mut stream = Box::pin(resp.bytes_stream());
    let mut rx = rx;
    loop {
        // Pin<Box<S>> 是 Unpin 的，StreamExt::next 直接可用
        let next = stream.next();
        match select(rx, next).await {
            // 取消：断流（连接随之关闭）
            Either::Left((_, _)) => {
                let _ = on_chunk.send(StreamEvent::Done);
                return Ok(());
            }
            Either::Right((item, next_rx)) => {
                rx = next_rx;
                match item {
                    Some(Ok(bytes)) => {
                        let _ = on_chunk.send(StreamEvent::Chunk {
                            bytes_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                        });
                    }
                    Some(Err(e)) => {
                        let _ = on_chunk.send(StreamEvent::Error { message: format!("读取失败：{e}") });
                        return Ok(());
                    }
                    None => {
                        let _ = on_chunk.send(StreamEvent::Done);
                        return Ok(());
                    }
                }
            }
        }
    }
}

/// 取消进行中的流式会话（断开底层连接）。
#[tauri::command]
pub fn llm_cancel_stream(state: tauri::State<'_, StreamRegistry>, session_id: String) -> Result<(), String> {
    state.cancel(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_url;

    #[test]
    fn validate_url_allows_https_and_loopback() {
        assert!(validate_url("https://open.bigmodel.cn/api/paas/v4/chat/completions").is_ok());
        assert!(validate_url("http://localhost:11434/v1/chat/completions").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/v1").is_ok());
    }

    #[test]
    fn validate_url_rejects_plain_http() {
        assert!(validate_url("http://example.com/v1").is_err());
        assert!(validate_url("ftp://x").is_err());
        assert!(validate_url("").is_err());
    }
}
