pub mod appcfg;
pub mod build;
pub mod codegen;
pub mod commands;
pub mod error;
pub mod events;
pub mod flash;
pub mod geometry;
pub mod keyboards;
pub mod layout;
pub mod oryx;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // App-lifetime USB watcher: presence edges of the DFU
            // bootloader (0483:df11) become `dfu-device` events.
            let handle = app.handle().clone();
            flash::watcher::spawn(move |present| events::emit_dfu_device(&handle, present));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_layout,
            commands::save_layout,
            commands::seed_from_oryx,
            commands::get_geometry,
            commands::list_layouts,
            commands::select_layout,
            commands::create_layout,
            commands::duplicate_layout,
            commands::rename_layout,
            commands::delete_layout,
            commands::list_keyboards,
            commands::get_keyboard_geometry,
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
