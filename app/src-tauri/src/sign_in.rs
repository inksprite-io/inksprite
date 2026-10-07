//! Signing in through the system browser.
//!
//! The page builds the address to sign in at; this opens it in the system
//! browser and listens on localhost for the service to send the browser back.
//! The first request to the expected path is answered with a page that says to
//! go back to the app, and its query is handed to the page, which finishes the
//! sign-in itself (`src/platform/signIn.js`).

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// How long a sign-in is waited for.
const WAIT: Duration = Duration::from_secs(10 * 60);

/// How often the listeners are looked at, and how soon a stop is noticed.
const POLL: Duration = Duration::from_millis(50);

/// How long a stopped sign-in may take to let go of the port.
const RELEASE: Duration = Duration::from_secs(1);

/// What the browser is shown once it is back.
const PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>inksprite</title>\
<body style=\"font: 16px system-ui, sans-serif; margin: 4rem auto; max-width: 28rem; text-align: center\">\
<p>You can close this tab and go back to inksprite.</p>";

/// The sign-in being waited for, if any, by its id: setting its flag stops it.
#[derive(Default)]
pub struct Waiting {
    current: Mutex<Option<(u64, Arc<AtomicBool>)>>,
    next: AtomicU64,
}

/// Open `address` in the system browser, and wait on `port` for the service
/// to send the browser back to `path`. The query it comes back with is sent on
/// `on_return`, once; nothing is sent if the wait is stopped or runs out.
/// Returns the sign-in's id, for `stop_sign_in`.
#[tauri::command]
pub async fn sign_in_in_browser(
    app: AppHandle,
    waiting: State<'_, Waiting>,
    address: String,
    port: u16,
    path: String,
    on_return: Channel<String>,
) -> Result<u64, String> {
    let id = waiting.next.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    // A sign-in started while another waits takes its place.
    if let Some((_, previous)) = waiting.current.lock().unwrap().replace((id, stop.clone())) {
        previous.store(true, Ordering::Relaxed);
    }

    let listeners = bind(port)?;
    app.opener()
        .open_url(&address, None::<&str>)
        .map_err(|error| format!("The browser could not be opened: {error}"))?;

    thread::spawn(move || {
        if let Some(query) = wait(&listeners, &path, &stop, WAIT) {
            let _ = on_return.send(query);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
    });
    Ok(id)
}

/// Stop waiting for a sign-in, if it is the one still being waited for.
#[tauri::command]
pub fn stop_sign_in(waiting: State<'_, Waiting>, id: u64) {
    let mut current = waiting.current.lock().unwrap();
    if let Some((waited, stop)) = current.as_ref() {
        if *waited == id {
            stop.store(true, Ordering::Relaxed);
            *current = None;
        }
    }
}

/// Listen on `port`, on both loopback addresses: `localhost` is IPv6 first on
/// some systems. A sign-in just stopped may hold the port for a moment yet.
fn bind(port: u16) -> Result<Vec<TcpListener>, String> {
    let deadline = Instant::now() + RELEASE;
    let v4 = loop {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => break listener,
            Err(_) if Instant::now() < deadline => thread::sleep(POLL),
            Err(error) => return Err(in_use(port, error)),
        }
    };
    let mut listeners = vec![v4];
    if let Ok(v6) = TcpListener::bind(("::1", port)) {
        listeners.push(v6);
    }
    for listener in &listeners {
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
    }
    Ok(listeners)
}

/// What the writer is told when the port cannot be listened on.
fn in_use(port: u16, error: std::io::Error) -> String {
    format!("Port {port} is in use, so the sign-in could not come back to inksprite: {error}")
}

/// Wait for the request to `path`, until stopped or out of time, and return
/// its query. Anything else that arrives is turned away.
fn wait(
    listeners: &[TcpListener],
    path: &str,
    stop: &AtomicBool,
    time: Duration,
) -> Option<String> {
    let deadline = Instant::now() + time;
    while !stop.load(Ordering::Relaxed) && Instant::now() < deadline {
        for listener in listeners {
            if let Ok((stream, _)) = listener.accept() {
                if let Some(query) = answer(stream, path) {
                    return Some(query);
                }
            }
        }
        thread::sleep(POLL);
    }
    None
}

/// Read one request. The way back gets the page and its query is returned;
/// anything else gets a 404.
fn answer(mut stream: TcpStream, path: &str) -> Option<String> {
    // Accepted from a listener that does not block, it may not either.
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;

    let mut request = String::new();
    {
        let mut reader = BufReader::new(&stream);
        reader.read_line(&mut request).ok()?;
        // The headers are read too: closing on unread ones resets the
        // connection, and the browser would show that instead of the page.
        let mut header = String::new();
        while reader.read_line(&mut header).ok()? > 2 {
            header.clear();
        }
    }

    // "GET /connect/mcp?code=…&state=… HTTP/1.1"
    let target = request.split_whitespace().nth(1)?;
    let (route, query) = target.split_once('?').unwrap_or((target, ""));
    if route != path {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return None;
    }
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{PAGE}",
        PAGE.len()
    );
    Some(query.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// Send `request` to the port, and return what came back.
    fn send(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply
    }

    #[test]
    fn hands_back_the_query_and_tells_the_browser_to_go_back() {
        let listeners = bind(0).unwrap();
        let port = listeners[0].local_addr().unwrap().port();
        let browser = thread::spawn(move || {
            send(port, "GET /favicon.ico HTTP/1.1\r\nHost: localhost\r\n\r\n");
            send(port, "GET /connect/mcp?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\nAccept: */*\r\n\r\n")
        });

        let query = wait(
            &listeners,
            "/connect/mcp",
            &AtomicBool::new(false),
            Duration::from_secs(5),
        );

        assert_eq!(query.as_deref(), Some("code=abc&state=xyz"));
        let reply = browser.join().unwrap();
        assert!(reply.starts_with("HTTP/1.1 200 OK"));
        assert!(reply.contains("go back to inksprite"));
    }

    #[test]
    fn stops_when_told() {
        let listeners = bind(0).unwrap();
        let query = wait(
            &listeners,
            "/connect/mcp",
            &AtomicBool::new(true),
            Duration::from_secs(5),
        );
        assert_eq!(query, None);
    }

    #[test]
    fn gives_up_when_the_time_runs_out() {
        let listeners = bind(0).unwrap();
        let started = Instant::now();
        let query = wait(
            &listeners,
            "/connect/mcp",
            &AtomicBool::new(false),
            Duration::from_millis(200),
        );
        assert_eq!(query, None);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
