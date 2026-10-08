//! Updates, from the public repository's releases.
//!
//! The page asks for one as it opens and every so often after
//! (`src/platform/updates.js`). The latest release's `latest.json` names each
//! platform's build and its signature (`.github/workflows/release.yml`). A
//! newer build is downloaded, its signature checked against the key in
//! `tauri.conf.json`, and kept until the writer restarts into it.
//!
//! These commands, rather than the plugin's own, are what the page can call:
//! it may ask for an update, but not say where from or which.

use tauri::async_runtime::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update downloaded and checked, waiting to be installed.
#[derive(Default)]
pub struct Downloaded(Mutex<Option<(Update, Vec<u8>)>>);

/// Look for an update, and download it. Returns its version, or nothing when
/// the app is up to date. Once one is downloaded, returns that one without
/// looking again.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    downloaded: State<'_, Downloaded>,
) -> Result<Option<String>, String> {
    // `cargo tauri dev` runs from the build folder, not an installed app.
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    // Held through the download, so that a second ask waits for the first.
    let mut downloaded = downloaded.0.lock().await;
    if let Some((update, _)) = downloaded.as_ref() {
        return Ok(Some(update.version.clone()));
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let version = update.version.clone();
    *downloaded = Some((update, bytes));
    Ok(Some(version))
}

/// Install the downloaded update, and restart into it. On Windows the
/// installer closes the app and opens the new one itself.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    downloaded: State<'_, Downloaded>,
) -> Result<(), String> {
    let downloaded = downloaded.0.lock().await;
    let Some((update, bytes)) = downloaded.as_ref() else {
        return Err("No update has been downloaded.".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}
