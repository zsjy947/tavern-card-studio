//! 共享 reqwest 连接池（技术债 D1）。
//!
//! 之前 http.rs / llm.rs 每个请求各建一个 `reqwest::Client`，同渠道连续对话
//! 重复 TLS 握手。这里用 `OnceLock` 全局共享一个 Client（预置 connect_timeout 15s）；
//! 各命令的请求级超时通过 `.timeout()` / `.timeout(Duration)` 挂在 Request 上，互不冲突。

use std::sync::OnceLock;
use std::time::Duration;

static SHARED_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 全局共享 Client（连接池复用；仅约束建连超时，不设总超时）
pub fn shared_client() -> &'static reqwest::Client {
    SHARED_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("reqwest::Client 构建失败")
    })
}

#[cfg(test)]
mod tests {
    use super::shared_client;

    #[test]
    fn shared_client_is_static_and_usable() {
        // OnceLock 保证两次调用返回同一实例；此处验证可用性与生命周期
        let c1: &'static reqwest::Client = shared_client();
        let c2: &'static reqwest::Client = shared_client();
        assert!(std::ptr::eq(c1, c2));
    }
}
