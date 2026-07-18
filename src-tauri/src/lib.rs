pub mod appcfg;
pub mod build;
pub mod codegen;
pub mod commands;
pub mod error;
pub mod events;
pub mod flash;
pub mod geometry;
pub mod layout;
pub mod oryx;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_layout,
            commands::save_layout,
            commands::seed_from_oryx,
            commands::get_geometry,
            commands::get_app_config,
            commands::set_app_config,
            commands::generate_sources,
            commands::build_firmware,
            commands::start_flash_pipeline,
            commands::cancel_pipeline,
            commands::list_dfu_devices,
            commands::flash_firmware,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
