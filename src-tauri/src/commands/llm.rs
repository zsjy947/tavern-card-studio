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
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(old) = map.insert(session_id, tx) {
            // 同 id 重复注册：终止旧流，避免旧流从此不可取消
            let _ = old.send(());
        }
    }

    fn remove(&self, session_id: &str) {
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        map.remove(session_id);
    }

    fn cancel(&self, session_id: &str) -> bool {
        let tx = self
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(session_id);
        match tx {
            Some(tx) => {
                let _ = tx.send(());
                true
            }
            None => false,
        }
    }
}

/// 会话退出时从注册表移除（取消路径已移除时幂等）
struct SessionGuard<'a>(&'a StreamRegistry, String);

impl Drop for SessionGuard<'_> {
    fn drop(&mut self) {
        self.0.remove(&self.1);
    }
}

/// Channel 事件（JSON 序列化，tag=事件类型）。
/// 注意 rename_all_fields：JS 侧按 camelCase 读取（bytesB64/contentType），
/// 变体名的 rename_all 只管变体名本身，字段必须单独声明。
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StreamEvent {
    /// 响应头就绪（status/contentType 先行通知，JS 侧据此构造 Response）
    Headers { status: u16, content_type: String },
    /// 数据块（base64；SSE 文本也按字节传，保持任意 content-type 兼容）
    Chunk { bytes_b64: String },
    Done,
    Error { message: String },
}

/// 允许的目标：https 任意；http 仅限本机回环（本地网关如 Ollama/LM Studio）。
/// 回环判定按主机名精确匹配，防 `http://localhost.evil.com` 式前缀绕过。
fn validate_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let host = if let Some(after_bracket) = rest.strip_prefix('[') {
            let end = after_bracket.find(']').unwrap_or(0);
            &rest[..end + 2] // 含两侧方括号
        } else {
            rest.split(['/', ':', '?', '#']).next().unwrap_or("")
        };
        if matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
            return Ok(());
        }
    }
    Err("仅支持 https 或本机回环地址".into())
}

/// 流式请求：headers 由前端传入（authorization 等），body 为完整请求体字符串。
/// 事件序：Headers → Chunk* → Done | Error。取消经 llm_cancel_stream（建连期同样有效）。
#[tauri::command]
pub async fn llm_post_stream(
    state: tauri::State<'_, StreamRegistry>,
    url: String,
    method: Option<String>,
    headers: HashMap<String, String>,
    body: String,
    session_id: String,
    on_chunk: Channel<StreamEvent>,
) -> Result<(), String> {
    if body.len() > 32 * 1024 * 1024 {
        return Err("请求体超过 32MB 上限".into());
    }
    validate_url(&url)?;
    let verb = method.unwrap_or_else(|| "POST".to_string());
    let m = reqwest::Method::from_bytes(verb.as_bytes())
        .map_err(|_| format!("非法 HTTP 方法：{verb}"))?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.request(m.clone(), &url);
    // content-type 只在带请求体的方法上设置一次（避免与前端传入的头重复 append）
    if matches!(m, reqwest::Method::POST | reqwest::Method::PUT | reqwest::Method::PATCH) {
        req = req.header("content-type", "application/json").body(body);
    }
    for (k, v) in &headers {
        if k.eq_ignore_ascii_case("content-type") {
            continue;
        }
        req = req.header(k, v);
    }

    // 建连前先注册取消句柄，连接挂死时 llm_cancel_stream 也能生效
    let (tx, rx) = oneshot::channel::<()>();
    state.register(session_id.clone(), tx);
    let _guard = SessionGuard(&state, session_id);

    let resp = req
        .send()
        .await
        .map_err(|e| format!("连接失败：{e}"))?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let _ = on_chunk.send(StreamEvent::Headers { status, content_type });

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
                        let sent = on_chunk.send(StreamEvent::Chunk {
                            bytes_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                        });
                        // 通道关闭（webview 销毁）：停止拉取上游
                        if sent.is_err() {
                            return Ok(());
                        }
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
    use super::{validate_url, StreamEvent, StreamRegistry};

    #[test]
    fn validate_url_allows_https_and_loopback() {
        assert!(validate_url("https://open.bigmodel.cn/api/paas/v4/chat/completions").is_ok());
        assert!(validate_url("http://localhost:11434/v1/chat/completions").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(validate_url("http://[::1]:8080/v1").is_ok());
    }

    #[test]
    fn validate_url_rejects_plain_http_and_lookalikes() {
        assert!(validate_url("http://example.com/v1").is_err());
        assert!(validate_url("http://localhost.evil.com/v1").is_err());
        assert!(validate_url("http://127.0.0.1.evil.com/v1").is_err());
        assert!(validate_url("ftp://x").is_err());
        assert!(validate_url("").is_err());
    }

    /** 契约锚点：JS 侧 tauriStream.ts 按 camelCase 读事件字段 */
    #[test]
    fn stream_event_serializes_camel_case_fields() {
        assert_eq!(
            serde_json::to_string(&StreamEvent::Headers { status: 200, content_type: "text/event-stream".into() }).unwrap(),
            r#"{"event":"headers","status":200,"contentType":"text/event-stream"}"#
        );
        assert_eq!(
            serde_json::to_string(&StreamEvent::Chunk { bytes_b64: "AAA".into() }).unwrap(),
            r#"{"event":"chunk","bytesB64":"AAA"}"#
        );
        assert_eq!(serde_json::to_string(&StreamEvent::Done).unwrap(), r#"{"event":"done"}"#);
        assert_eq!(
            serde_json::to_string(&StreamEvent::Error { message: "boom".into() }).unwrap(),
            r#"{"event":"error","message":"boom"}"#
        );
    }

    #[test]
    fn stream_registry_register_cancel_and_cleanup() {
        let reg = StreamRegistry::default();
        let (tx, _rx) = futures::channel::oneshot::channel::<()>();
        reg.register("s1".into(), tx);
        assert!(reg.cancel("s1"));
        assert!(!reg.cancel("s1")); // 已移除，二次取消假阳性
        assert!(!reg.cancel("unknown"));

        // 重复注册同 id：旧流被终止（旧 tx 收到取消信号）
        let (tx1, mut rx1) = futures::channel::oneshot::channel::<()>();
        reg.register("s2".into(), tx1);
        let (tx2, _rx2) = futures::channel::oneshot::channel::<()>();
        reg.register("s2".into(), tx2);
        assert!(rx1.try_recv().is_ok()); // 旧会话已被取消信号唤醒
        drop(rx1);
    }
}
