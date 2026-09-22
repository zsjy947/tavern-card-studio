// TavernCard Studio —— Tauri 2 壳
// Rust 只做三件事：注册插件、便携模式数据目录、窗口生命周期。
// 业务逻辑全部在前端 TypeScript（src/）。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tavern_card_studio_lib::run()
}
