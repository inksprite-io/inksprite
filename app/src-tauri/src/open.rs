//! Links the page opens in the system browser (`src/platform/open.js`).
//!
//! A link followed in the app's window takes the app's place, so the page
//! hands links to other sites here instead. The page shows what models write,
//! so only web and mail links are opened, whatever the page asks for.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// The schemes a link may open with.
const SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Whether `url` is a web or mail link.
fn openable(url: &str) -> bool {
    url.split_once(':')
        .is_some_and(|(scheme, _)| SCHEMES.contains(&scheme.to_ascii_lowercase().as_str()))
}

/// Open a link in the system browser, or a mail link in the mail app.
#[tauri::command]
pub fn open_in_browser(app: AppHandle, url: String) -> Result<(), String> {
    if !openable(&url) {
        return Err(format!("Not a link that opens: {url}"));
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|error| format!("The browser could not be opened: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_web_and_mail_links() {
        assert!(openable("https://example.com/a?b=c"));
        assert!(openable("HTTP://example.com"));
        assert!(openable("mailto:someone@example.com"));
    }

    #[test]
    fn refuses_anything_else() {
        assert!(!openable("javascript:alert(1)"));
        assert!(!openable("file:///etc/passwd"));
        assert!(!openable(" https://example.com"));
        assert!(!openable("example.com"));
    }
}
