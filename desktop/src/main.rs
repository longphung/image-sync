// Hides the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod import;
mod server;
mod thumbs;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime};
use tauri::http::{Response, StatusCode};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};

const NO_CAMERA: &str = "No camera found. Set the camera's USB Connection to Mass Storage and plug it in.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub library: PathBuf,
    /// Applies on restart.
    pub port: u16,
    /// One-time pairing token shown in the QR; `POST /pair` trades it for a phone's own token.
    pub token: String,
    pub phones: Vec<Phone>,
    pub id: String,
    /// Optional extra address put in the pairing QR for remote access, e.g. a Tailscale name.
    pub remote_host: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            library: PathBuf::new(),
            port: 8765,
            token: new_token(),
            phones: Vec::new(),
            id: uuid::Uuid::new_v4().to_string(),
            remote_host: String::new(),
        }
    }
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// A paired phone. Each has its own token, so one can be removed without re-pairing the others.
#[derive(Clone, Serialize, Deserialize)]
pub struct Phone {
    pub id: String,
    pub name: String,
    pub token: String,
    /// Unix seconds.
    pub paired: u64,
}

impl Phone {
    fn new(name: String) -> Self {
        let paired = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        Phone { id: uuid::Uuid::new_v4().to_string(), name, token: new_token(), paired }
    }
}

#[derive(Clone, Default, Serialize)]
struct ImportStatus {
    running: bool,
    volume: Option<String>,
    counts: import::Counts,
    error: Option<String>,
}

pub struct App {
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    status: Mutex<ImportStatus>,
    importing: AtomicBool,
    /// The camera volume last listed by `card`; card thumbnails are only served from inside it.
    card_root: Mutex<Option<PathBuf>>,
    thumbs: Arc<thumbs::Queue>,
    card_thumbs_dir: PathBuf,
    /// The pending "pair by code" request, whose code the window shows.
    pair_request: Mutex<Option<server::PairRequest>>,
    handle: AppHandle,
}

impl App {
    pub fn settings(&self) -> MutexGuard<'_, Settings> {
        self.settings.lock().unwrap()
    }

    fn save_settings(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&*self.settings()).unwrap();
        fs::create_dir_all(self.settings_path.parent().unwrap())
            .and_then(|_| fs::write(&self.settings_path, json))
            .map_err(|e| format!("Couldn't save settings: {e}"))
    }

    /// Imports the chosen files from one camera volume. Returns false without doing anything if an
    /// import is already running.
    fn import(&self, root: &Path, files: &[PathBuf]) -> bool {
        if self.importing.swap(true, Ordering::SeqCst) {
            return false;
        }
        let library = self.settings().library.clone();
        *self.status.lock().unwrap() =
            ImportStatus { running: true, volume: Some(root.display().to_string()), ..Default::default() };
        let result = import::import_files(files, &library, thumbs::ffmpeg(), |c| self.status.lock().unwrap().counts = c.clone());
        let mut status = self.status.lock().unwrap();
        status.running = false;
        status.error = result.err().map(|e| format!("Import failed: {e}"));
        self.importing.store(false, Ordering::SeqCst);
        true
    }
}

/// The mounted camera / card volume, polled on demand. One camera at a time is supported.
fn camera_volume() -> Option<PathBuf> {
    let mut volumes: Vec<_> = sysinfo::Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|d| d.mount_point().to_path_buf())
        .filter(|p| import::is_camera_volume(p))
        .collect();
    volumes.sort();
    volumes.into_iter().next()
}

/// Best-guess LAN address: the local end of a UDP "connection" (no packet is sent).
fn lan_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn host_name() -> String {
    let name = sysinfo::System::host_name().unwrap_or_else(|| "image-sync".into());
    name.trim_end_matches(".local").to_string()
}

/// The addresses a phone should try (LAN IP, then the optional remote one) and this desktop's name.
pub fn pairing_info(settings: &Settings) -> (Vec<String>, String) {
    let hosts = lan_ip().into_iter().chain(Some(settings.remote_host.clone()).filter(|h| !h.is_empty())).collect();
    (hosts, host_name())
}

#[derive(Serialize)]
struct PairRequestView {
    name: String,
    code: String,
    expires_in: u64,
}

#[derive(Serialize)]
struct StatusView {
    import: ImportStatus,
    camera: Option<PathBuf>,
    settings: Settings,
    ffmpeg: bool,
    pairing_qr: String,
    lan_ip: Option<String>,
    pair_request: Option<PairRequestView>,
}

#[tauri::command]
fn status(app: State<Arc<App>>) -> StatusView {
    let settings = app.settings().clone();
    let (hosts, name) = pairing_info(&settings);
    let payload = serde_json::json!({
        "v": 1, "id": settings.id, "name": name, "hosts": hosts, "port": settings.port, "token": settings.token,
    });
    let pairing_qr = qrcode::QrCode::new(payload.to_string())
        .map(|qr| qr.render::<qrcode::render::svg::Color>().min_dimensions(240, 240).build())
        .unwrap_or_default();
    StatusView {
        import: app.status.lock().unwrap().clone(),
        camera: camera_volume(),
        settings,
        ffmpeg: thumbs::ffmpeg().is_some(),
        pairing_qr,
        lan_ip: lan_ip(),
        pair_request: app.pair_request.lock().unwrap().as_ref().and_then(|r| {
            let left = r.expires.checked_duration_since(Instant::now())?;
            Some(PairRequestView { name: r.name.clone(), code: r.code.clone(), expires_in: left.as_secs() })
        }),
    }
}

#[derive(Serialize)]
struct MediaItem {
    name: String,
    path: PathBuf,
    size: u64,
    video: bool,
    imported: bool,
}

/// Every photo and video on the camera, newest first, for the window's picker.
#[tauri::command]
fn card(app: State<Arc<App>>, handle: AppHandle) -> Result<Vec<MediaItem>, String> {
    let root = camera_volume().ok_or(NO_CAMERA)?;
    // Lets the window preview full-size files straight off the card.
    handle.asset_protocol_scope().allow_directory(&root, true).map_err(|e| e.to_string())?;
    *app.card_root.lock().unwrap() = Some(root.clone());
    let library = app.settings().library.clone();
    let mut items: Vec<(SystemTime, MediaItem)> = import::media_files(&root)
        .into_iter()
        .filter_map(|path| {
            let meta = fs::metadata(&path).ok()?;
            let item = MediaItem {
                name: path.file_name()?.to_str()?.to_string(),
                size: meta.len(),
                video: import::is_video(&path),
                imported: import::is_imported(&path, &library),
                path,
            };
            Some((meta.modified().ok()?, item))
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0));
    let items: Vec<MediaItem> = items.into_iter().map(|(_, item)| item).collect();
    app.thumbs.prefetch(items.iter().map(|i| (i.path.clone(), app.card_thumb_path(&i.path, i.size))).collect());
    Ok(items)
}

/// Everything already synced into the library, newest first.
#[tauri::command]
fn library(app: State<Arc<App>>, handle: AppHandle) -> Result<Vec<MediaItem>, String> {
    let library = app.settings().library.clone();
    handle.asset_protocol_scope().allow_directory(&library, true).map_err(|e| e.to_string())?;
    let items = server::library_files(&library).into_iter().rev().filter_map(|path| {
        let size = fs::metadata(&path).ok()?.len();
        let name = path.file_name()?.to_str()?.to_string();
        Some(MediaItem { size, video: import::is_video(&path), imported: true, name, path })
    });
    Ok(items.collect())
}

/// Opens the library folder in Finder / Explorer / the file manager.
#[tauri::command]
fn open_library(app: State<Arc<App>>) -> Result<(), String> {
    let library = app.settings().library.clone();
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    fs::create_dir_all(&library)
        .and_then(|_| std::process::Command::new(opener).arg(&library).spawn())
        .map(|_| ())
        .map_err(|e| format!("Couldn't open {}: {e}", library.display()))
}

/// Imports the picked card files, by path (names repeat once Sony's counter wraps), in the background.
#[tauri::command]
fn sync(app: State<Arc<App>>, paths: Vec<PathBuf>) -> Result<(), String> {
    let root = camera_volume().ok_or(NO_CAMERA)?;
    let paths: HashSet<PathBuf> = paths.into_iter().collect();
    let files: Vec<PathBuf> = import::media_files(&root).into_iter().filter(|p| paths.contains(p)).collect();
    let app = app.inner().clone();
    std::thread::spawn(move || app.import(&root, &files));
    Ok(())
}

impl App {
    /// Keyed by name and size so a different card's DSC00001.JPG doesn't reuse a stale thumbnail.
    fn card_thumb_path(&self, src: &Path, size: u64) -> PathBuf {
        let name = src.file_name().unwrap_or_default().to_string_lossy();
        self.card_thumbs_dir.join(format!("{name}-{size}.jpg"))
    }
}

/// `thumb://` serves a grid thumbnail for a file on the camera or in the library, via the
/// thumbnail queue. Library thumbnails share `<library>/.thumbs/` with the phone API.
fn thumb(app: &App, uri_path: &str, reply: Box<dyn FnOnce(Option<Vec<u8>>) + Send>) {
    let Ok(path) = percent_encoding::percent_decode_str(uri_path.trim_start_matches('/')).decode_utf8() else {
        return reply(None);
    };
    let path = PathBuf::from(path.as_ref());
    let safe = import::is_media(&path) && !path.components().any(|c| c == std::path::Component::ParentDir);
    let library = app.settings().library.clone();
    let out = if path.starts_with(&library) {
        Some(server::library_thumb(&path))
    } else if app.card_root.lock().unwrap().as_ref().is_some_and(|root| path.starts_with(root)) {
        fs::metadata(&path).ok().map(|meta| app.card_thumb_path(&path, meta.len()))
    } else {
        None
    };
    match out {
        Some(out) if safe => app.thumbs.get(path, out, reply),
        _ => reply(None),
    }
}

#[tauri::command]
fn save_settings(
    app: State<Arc<App>>,
    library: String,
    port: u16,
    remote_host: String,
) -> Result<(), String> {
    if library.trim().is_empty() {
        return Err("Library folder can't be empty.".into());
    }
    {
        let mut s = app.settings();
        s.library = PathBuf::from(library.trim());
        s.port = port;
        s.remote_host = remote_host.trim().to_string();
    }
    app.save_settings()
}

#[tauri::command]
fn remove_phone(app: State<Arc<App>>, id: String) -> Result<(), String> {
    app.settings().phones.retain(|p| p.id != id);
    app.save_settings()
}

/// Revokes every paired phone and the QR on screen; each phone has to scan the new one.
#[tauri::command]
fn unpair_all(app: State<Arc<App>>) -> Result<(), String> {
    {
        let mut s = app.settings();
        s.phones.clear();
        s.token = new_token();
    }
    *app.pair_request.lock().unwrap() = None;
    app.save_settings()
}

#[tauri::command]
fn deny_pair_request(app: State<Arc<App>>) {
    *app.pair_request.lock().unwrap() = None;
}

pub fn show_window(handle: &AppHandle) {
    if let Some(w) = handle.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![status, card, library, open_library, sync, save_settings, remove_phone, unpair_all, deny_pair_request])
        .register_asynchronous_uri_scheme_protocol("thumb", |ctx, req, responder| {
            let app = ctx.app_handle().state::<Arc<App>>();
            thumb(&app, req.uri().path(), Box::new(move |jpeg| {
                let response = match jpeg {
                    // Cached on disk by name + size, so the webview may cache it too.
                    Some(jpeg) => Response::builder()
                        .header("Content-Type", "image/jpeg")
                        .header("Cache-Control", "max-age=31536000, immutable")
                        .body(jpeg),
                    None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
                };
                responder.respond(response.unwrap());
            }));
        })
        .setup(|tauri_app| {
            let paths = tauri_app.path();
            let settings_path = paths.app_config_dir()?.join("settings.json");
            let mut settings: Settings =
                fs::read(&settings_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            if settings.library.as_os_str().is_empty() {
                settings.library = paths.picture_dir().or_else(|_| paths.home_dir())?.join("image-sync");
            }
            let port = settings.port;
            let app = Arc::new(App {
                settings: Mutex::new(settings),
                settings_path,
                status: Mutex::default(),
                importing: AtomicBool::new(false),
                card_root: Mutex::default(),
                thumbs: thumbs::Queue::start(),
                card_thumbs_dir: paths.app_cache_dir()?.join("card-thumbs"),
                pair_request: Mutex::default(),
                handle: tauri_app.handle().clone(),
            });
            // Persists a freshly generated token / id on first run.
            app.save_settings()?;

            // The phone app's web export, bundled as a resource (see tauri.conf.json).
            let web_dir = paths.resource_dir()?.join("web");
            let server_app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(server_app.clone(), port, web_dir).await {
                    server_app.status.lock().unwrap().error = Some(format!("HTTP server on port {port} failed: {e}"));
                }
            });

            // mDNS advert; the daemon is kept alive in managed state.
            let mdns = mdns_sd::ServiceDaemon::new()?;
            let name = host_name();
            let id = app.settings().id.clone();
            let txt = [("id", id.as_str()), ("v", "1"), ("name", name.as_str())];
            let service =
                mdns_sd::ServiceInfo::new("_image-sync._tcp.local.", &name, &format!("{name}.local."), "", port, &txt[..])?
                    .enable_addr_auto();
            mdns.register(service)?;
            tauri_app.manage(mdns);

            let open = MenuItem::with_id(tauri_app, "open", "Open", true, None::<&str>)?;
            let quit = MenuItem::with_id(tauri_app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(tauri_app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(tauri_app.default_window_icon().unwrap().clone())
                .tooltip("Image Sync")
                .menu(&menu)
                .on_menu_event(|handle, event| match event.id.as_ref() {
                    "open" => show_window(handle),
                    "quit" => handle.exit(0),
                    _ => {}
                })
                .build(tauri_app)?;
            tauri_app.manage(app);
            Ok(())
        })
        // Closing the window hides it to the tray; Quit is in the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            // macOS: clicking the Dock icon reopens the hidden window.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_window(handle);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (handle, event);
        });
}
