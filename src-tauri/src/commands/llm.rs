//! LLM 流式代理：桌面端绕过 webview fetch 的 CORS/连接复用限制，
//! SSE 逐块经 Channel 回传，JS 侧合成 ReadableStream Response。
//! 取消：llm_cancel_stream(session_id) 断开底层连接。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use futures::channel::oneshot;
use futures::future::{select, Either};
use futures::StreamExt;
use futures::FutureExt;
use tauri::ipc::Channel;

use crate::commands::net::shared_client;

/// 攒批窗口（技术债 D2.1）：SSE 小块逐 chunk base64+JSON IPC 开销大（+33% 膨胀、
/// 长文数千帧），按 ~16ms 时间窗合并原始字节后一起发。我们传的是上游原始字节流，
/// 合并拼接无损，前端 ReadableStream 语义不变。大块超阈值立即冲刷避免额外延迟。
const BATCH_WINDOW: Duration = Duration::from_millis(16);
const BATCH_WATERMARK: usize = 64 * 1024;

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
fn validate_url(url: &str) -> Result<(), String> {    if url.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let host = if let Some(after_bracket) = rest.strip_prefix('[') {
            match after_bracket.find(']') {
                // 含两侧方括号；找不到闭括号直接拒绝（避免越界切片）
                Some(end) => &rest[..end + 2],
                None => return Err("仅支持 https 或本机回环地址".into()),
            }
        } else {
            rest.split(['/', ':', '?', '#']).next().unwrap_or("")
        };
        if matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
            return Ok(());
        }
    }
    Err("仅支持 https 或本机回环地址".into())
}

/// 攒批状态机（技术债 D2.1 的可测化抽取，ROADMAP §三.7）：
/// 窗口（~16ms）内的上游小块合并为一帧；大块达水位立即冲刷；窗口到点/流终止无条件取走。
/// 纯同步状态机——时间由调用方以 `Instant` 注入，单测无需 tokio。
struct Batcher {
    pending: Vec<u8>,
    window_open: bool,
    window_start: Instant,
}

impl Batcher {
    fn new() -> Self {
        Self {
            pending: Vec::with_capacity(16 * 1024),
            window_open: false,
            window_start: Instant::now(),
        }
    }

    /// 上游一块到达：首个块开启窗口；并入攒批，达水位立即冲刷并返回该帧
    /// （单大块可超水位整帧直发——与原内联实现一致，避免额外复制）。
    fn push(&mut self, bytes: &[u8], now: Instant) -> Option<Vec<u8>> {
        if !self.window_open {
            self.window_open = true;
            self.window_start = now;
        }
        self.pending.extend_from_slice(bytes);
        if self.pending.len() >= BATCH_WATERMARK {
            self.window_open = false;
            return Some(std::mem::take(&mut self.pending));
        }
        None
    }

    /// 无条件取走已攒字节（窗口到点 / 取消 / 上游错误 / 流结束）。空攒批返回 None。
    fn take(&mut self) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            return None;
        }
        self.window_open = false;
        Some(std::mem::take(&mut self.pending))
    }

    /// 窗口开启时返回剩余时间（外层据此给上游等待加超时）；未开窗返回 None（裸等下一事件）。
    fn window_remain(&self, now: Instant) -> Option<Duration> {
        if !self.window_open {
            return None;
        }
        Some(BATCH_WINDOW.saturating_sub(now.saturating_duration_since(self.window_start)))
    }
}

/// 发一帧数据块（base64）。通道关闭（webview 销毁）返回 Err，调用方应停止拉取上游。
fn send_chunk(on_chunk: &Channel<StreamEvent>, frame: &[u8]) -> Result<(), ()> {
    on_chunk
        .send(StreamEvent::Chunk {
            bytes_b64: base64::engine::general_purpose::STANDARD.encode(frame),
        })
        .map_err(|_| ())
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

    let client = shared_client();
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
    // D2.1 攒批：Batcher 状态机（单测覆盖）——窗口内小块合并一帧；窗口到点/大块/终止时冲刷
    let mut batcher = Batcher::new();

    type WaitFuture<'a> = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<Result<bytes::Bytes, reqwest::Error>>, tokio::time::error::Elapsed>> + Send + 'a>,
    >;

    loop {
        // 窗口开启时给上游等待加「剩余窗口」超时：到点冲刷，不让尾块滞留到下个事件
        let now = Instant::now();
        let wait: WaitFuture<'_> = if let Some(remain) = batcher.window_remain(now) {
            Box::pin(tokio::time::timeout(remain, stream.next()))
        } else {
            // 窗口未开：等下一个上游事件即可（map 补上与 timeout 一致的 Ok 包裹）
            Box::pin(stream.next().map(Ok))
        };
        match select(rx, wait).await {
            // 取消：断流（连接随之关闭）
            Either::Left((_, _)) => {
                if let Some(frame) = batcher.take() {
                    let _ = send_chunk(&on_chunk, &frame);
                }
                let _ = on_chunk.send(StreamEvent::Done);
                return Ok(());
            }
            // Right 臂 = (wait 的输出, rx 原值)；item: Result<Option<上游项>, Elapsed>
            Either::Right((item, next_rx)) => {
                rx = next_rx;
                let upstream = match item {
                    Ok(upstream) => upstream,
                    // 16ms 窗口到点：冲刷已攒字节
                    Err(_elapsed) => {
                        if let Some(frame) = batcher.take() {
                            if send_chunk(&on_chunk, &frame).is_err() {
                                return Ok(());
                            }
                        }
                        continue;
                    }
                };
                match upstream {
                    Some(Ok(bytes)) => {
                        // 大块达水位立即冲刷，避免攒批引入额外延迟与内存占用
                        if let Some(frame) = batcher.push(&bytes, Instant::now()) {
                            if send_chunk(&on_chunk, &frame).is_err() {
                                // 通道关闭（webview 销毁）：停止拉取上游
                                return Ok(());
                            }
                        }
                    }
                    Some(Err(e)) => {
                        if let Some(frame) = batcher.take() {
                            let _ = send_chunk(&on_chunk, &frame);
                        }
                        let _ = on_chunk.send(StreamEvent::Error { message: format!("读取失败：{e}") });
                        return Ok(());
                    }
                    None => {
                        if let Some(frame) = batcher.take() {
                            let _ = send_chunk(&on_chunk, &frame);
                        }
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
    use super::{validate_url, Batcher, StreamEvent, StreamRegistry, BATCH_WATERMARK, BATCH_WINDOW};
    use std::time::{Duration, Instant};

    /* ---------------- Batcher（攒批状态机，ROADMAP §三.7） ---------------- */

    #[test]
    fn batcher_accumulates_small_chunks_until_take() {
        let mut b = Batcher::new();
        let t0 = Instant::now();
        assert_eq!(b.window_remain(t0), None, "未 push 前窗口不开");
        assert!(b.push(b"hello ", t0).is_none());
        assert!(b.push(b"world", t0).is_none());
        // 窗口开着：剩余时间 ≤ 16ms
        assert!(b.window_remain(t0).is_some_and(|r| r <= BATCH_WINDOW));
        let frame = b.take().expect("take 应冲刷攒批");
        assert_eq!(frame, b"hello world");
        // 取空后：再 take 为 None，窗口复位
        assert!(b.take().is_none());
        assert_eq!(b.window_remain(t0), None);
    }

    #[test]
    fn batcher_flushes_immediately_at_watermark_whole_block_passthrough() {
        let mut b = Batcher::new();
        let t0 = Instant::now();
        assert!(b.push(b"small", t0).is_none());
        // 单大块（>64KiB）达水位：整帧直发（可超水位），帧含此前攒入的小块
        let big = vec![b'x'; BATCH_WATERMARK + 7];
        let frame = b.push(&big, t0).expect("达水位应立即返回帧");
        assert_eq!(frame.len(), 5 + BATCH_WATERMARK + 7);
        assert!(b.take().is_none(), "冲刷后攒批为空");
    }

    #[test]
    fn batcher_window_expire_returns_zero_remain() {
        let mut b = Batcher::new();
        let t0 = Instant::now();
        b.push(b"data", t0);
        // 窗口到点（16ms 后）：剩余时间为 0，外层据此冲刷
        let later = t0 + BATCH_WINDOW + Duration::from_millis(1);
        assert_eq!(b.window_remain(later), Some(Duration::ZERO));
        let frame = b.take().expect("窗口到点应冲刷");
        assert_eq!(frame, b"data");
    }

    #[test]
    fn batcher_take_on_empty_is_safe() {
        let mut b = Batcher::new();
        let t0 = Instant::now();
        // 取消/上游错误/流结束路径在空攒批下也安全
        assert!(b.take().is_none());
        b.push(b"chunk", t0);
        assert!(b.take().is_some());
        assert!(b.take().is_none());
    }

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
