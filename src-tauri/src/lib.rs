pub mod appcfg;
pub mod build;
pub mod codegen;
pub mod commands;
pub mod error;
pub mod events;
pub mod flash;
pub mod geometry;
pub mod keyboards;
pub mod keyreport;
pub mod layout;
pub mod oryx;
pub mod rgb_effects;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Dev builds carry a labeled title so a hot-reloading `tauri dev`
            // instance is never mistaken for the installed app in the taskbar.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_title("qmk-flasher — DEV");
                }
            }
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
            commands::list_layout_versions,
            commands::restore_layout_version,
            commands::snapshot_layout,
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
            commands::start_key_reporting,
            commands::stop_key_reporting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
