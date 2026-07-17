pub mod build;
pub mod codegen;
pub mod commands;
pub mod events;
pub mod flash;
pub mod layout;
pub mod oryx;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_layout,
            commands::save_layout,
            commands::compile_firmware,
            commands::flash_firmware,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
