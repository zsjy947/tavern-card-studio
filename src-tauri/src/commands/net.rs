//! 共享 reqwest 连接池（技术债 D1）。
//!
//! 之前 http.rs / llm.rs 每个请求各建一个 `reqwest::Client`，同渠道连续对话
//! 重复 TLS 握手。这里用 `OnceLock` 全局共享一个 Client（预置 connect_timeout 15s）；
//! 各命令的请求级超时通过 `.timeout()` / `.timeout(Duration)` 挂在 Request 上，互不冲突。

use std::sync::OnceLock;
use std::time::Duration;

static SHARED_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 校验单个 URL：仅 https，或 http 且 host 为回环/localhost（本机 LLM 网关）。
/// validate_url（首跳校验）与重定向策略（每跳校验）共用。
pub fn is_allowed_target(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => match url.host_str() {
            Some(h) => {
                let h = h.trim_end_matches('.');
                h.eq_ignore_ascii_case("localhost")
                    || h == "127.0.0.1"
                    || h == "[::1]"
                    || h == "[0:0:0:0:0:0:0:1]"
            }
            None => false,
        },
        _ => false,
    }
}

/// 全局共享 Client（连接池复用；仅约束建连超时，不设总超时）。
/// 重定向逐跳校验目标：默认策略会跟随 https→http 降级到任意公网地址，
/// 使首跳的 https/回环校验被 302 绕过（SSRF）。这里每一跳都要求
/// https 或回环 http，与各命令的首跳 validate_url 语义一致。
pub fn shared_client() -> &'static reqwest::Client {
    SHARED_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > 10 {
                    return attempt.stop();
                }
                if is_allowed_target(attempt.url()) {
                    attempt.follow()
                } else {
                    let url = attempt.url().to_string();
                    attempt.error(format!("重定向目标不被允许：{url}"))
                }
            }))
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
