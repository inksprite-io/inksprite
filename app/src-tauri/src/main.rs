// The desktop app: the web build in a native window. What the window may do
// is listed in `capabilities/`; the design is `.llm/desktop_design.md`.

// No console window beside the app on Windows, in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sign_in;
mod update;

fn main() {
    tauri::Builder::default()
        // Requests to servers, made here rather than in the page, so that no
        // server refuses them for the page's origin (`src/platform/fetch.js`).
        .plugin(tauri_plugin_http::init())
        // Sign-ins, in the system browser and back (`sign_in.rs`).
        .plugin(tauri_plugin_opener::init())
        .manage(sign_in::Waiting::default())
        // Updates from the public repository's releases (`update.rs`).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Downloaded::default())
        .invoke_handler(tauri::generate_handler![
            sign_in::sign_in_in_browser,
            sign_in::stop_sign_in,
            update::download_update,
            update::install_update
        ])
        .run(tauri::generate_context!())
        .expect("the app could not start");
}
