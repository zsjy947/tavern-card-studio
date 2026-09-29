mod commands;

use commands::llm::StreamRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(StreamRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::db::db_url,
            commands::http::http_get_bytes,
            commands::fonts::font_dir,
            commands::fonts::font_write,
            commands::fonts::font_read,
            commands::fonts::font_exists,
            commands::fonts::font_delete,
            commands::llm::llm_post_stream,
            commands::llm::llm_cancel_stream,
            commands::export::export_dir,
            commands::export::pick_export_dir,
            commands::export::set_export_dir,
            commands::export::write_export,
            commands::export::open_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
