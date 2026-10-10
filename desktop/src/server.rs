//! HTTP API the mobile app pulls from. Same `ImageItem` JSON shape as `src/camera/types.ts`.
//! Every request needs the phone's own token (from `POST /pair`) as a `t=` query parameter; the
//! URLs returned by `/images` already include it, so the phone's image/video/download code needs
//! no headers.

use crate::tls::{self, DualListener, Peer};
use crate::{import, new_token, pairing_info, show_window, thumbs, App, Phone};
use axum::extract::{ConnectInfo, Path as UrlPath, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};

/// How long a code shown on the desktop stays valid, and how many wrong guesses it survives.
const CODE_TTL: Duration = Duration::from_secs(120);
const CODE_ATTEMPTS: u32 = 5;

/// A pending "pair by code" request: the phone asked, the desktop window shows `code`, and the
/// phone sends it back to `POST /pair/code`. Only one at a time; a new request replaces it.
pub struct PairRequest {
    pub id: String,
    pub name: String,
    pub code: String,
    pub expires: Instant,
    pub attempts: u32,
}

impl PairRequest {
    fn new(name: String) -> Self {
        let id = uuid::Uuid::new_v4();
        // ponytail: modulo bias over u32 is ~0.02%, irrelevant for a 2-minute, 5-try code.
        let n = u32::from_le_bytes(uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap()) % 1_000_000;
        PairRequest { id: id.to_string(), name, code: format!("{n:06}"), expires: Instant::now() + CODE_TTL, attempts: 0 }
    }
}

#[derive(Debug, PartialEq)]
enum CodeCheck {
    Ok,
    /// Wrong code; the request stays unless it ran out of attempts.
    Wrong,
    /// No such request (never made, replaced, used, expired or out of attempts).
    Gone,
}

/// Checks a code against the pending request, consuming it on success or its last failure.
fn check_code(pending: &mut Option<PairRequest>, id: &str, code: &str, now: Instant) -> CodeCheck {
    let Some(req) = pending.as_mut().filter(|r| r.id == id && now < r.expires) else {
        return CodeCheck::Gone;
    };
    if constant_time_eq(code, &req.code) {
        *pending = None;
        return CodeCheck::Ok;
    }
    req.attempts += 1;
    if req.attempts >= CODE_ATTEMPTS {
        *pending = None;
    }
    CodeCheck::Wrong
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageItem {
    title: String,
    url: String,
    filename: String,
    thumbnail_url: String,
}

/// `web_dir` is the phone app's web export, served at `/app` (same origin as the API, so the
/// browser needs no CORS). If it doesn't exist, `/app` is a 404 and the API is unaffected.
/// Plain HTTP and HTTPS share the port, see `tls.rs`.
pub async fn serve(app: Arc<App>, port: u16, web_dir: PathBuf, ca: tls::Ca) -> Result<(), String> {
    let ca_cert = ca.cert.clone();
    let names_app = app.clone();
    let acceptor = tls::acceptor(ca, move || tls::current_names(&names_app))?;
    let web = ServeDir::new(&web_dir).fallback(ServeFile::new(web_dir.join("index.html")));
    let router = Router::new()
        .route("/images", get(images))
        .route("/files/{*path}", get(file))
        .route("/thumbs/{*path}", get(thumb))
        .layer(middleware::from_fn_with_state(app.clone(), auth))
        // Routes added after the layer aren't covered by `auth`; the pair routes check their own secrets.
        .route("/pair", post(pair))
        .route("/pair/request", post(pair_request))
        .route("/pair/code", post(pair_code))
        .route("/info", get(info))
        // The phone installs this once to trust the hub's HTTPS (iOS opens it as a profile).
        .route("/ca.crt", get(|| async move { ([(header::CONTENT_TYPE, "application/x-x509-ca-cert")], ca_cert) }))
        .route("/", get(|| async { Redirect::temporary("/app/") }))
        .nest_service("/app", web)
        .with_state(app);
    let tcp = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| e.to_string())?;
    let listener = DualListener::new(tcp, acceptor);
    axum::serve(listener, router.into_make_service_with_connect_info::<Peer>()).await.map_err(|e| e.to_string())
}

fn query_param(req: &Request, key: &str) -> String {
    req.uri()
        .query()
        .and_then(|q| url::form_urlencoded::parse(q.as_bytes()).find(|(k, _)| k == key))
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default()
}

async fn auth(State(app): State<Arc<App>>, req: Request, next: Next) -> Response {
    let given = query_param(&req, "t");
    if app.settings().phones.iter().any(|p| constant_time_eq(&given, &p.token)) {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

/// `POST /pair?t=<pairing token from the QR>&name=<phone name>` returns the phone's own token
/// (see `add_phone`). The pairing token is replaced at once, so a QR is only good for one phone
/// and a photo of an old one is useless.
async fn pair(State(app): State<Arc<App>>, req: Request) -> Response {
    {
        let mut settings = app.settings();
        if !constant_time_eq(&query_param(&req, "t"), &settings.token) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        settings.token = new_token();
    }
    add_phone(&app, &query_param(&req, "name"))
}

/// `POST /pair/request?name=<phone name>` starts pairing by code: the desktop window pops up with
/// a 6-digit code, and the reply `{ "request": id }` is what the phone sends back with it.
async fn pair_request(State(app): State<Arc<App>>, req: Request) -> Response {
    let request = PairRequest::new(phone_name(&query_param(&req, "name")));
    let id = request.id.clone();
    *app.pair_request.lock().unwrap() = Some(request);
    show_window(&app.handle);
    Json(serde_json::json!({ "request": id })).into_response()
}

/// `POST /pair/code?request=<id>&code=<6 digits>&name=<phone name>`: same reply as `/pair`.
/// 401 for a wrong code (5 of them drop the request), 410 once there's nothing left to guess.
async fn pair_code(State(app): State<Arc<App>>, req: Request) -> Response {
    let checked =
        check_code(&mut app.pair_request.lock().unwrap(), &query_param(&req, "request"), &query_param(&req, "code"), Instant::now());
    match checked {
        CodeCheck::Ok => add_phone(&app, &query_param(&req, "name")),
        CodeCheck::Wrong => (StatusCode::UNAUTHORIZED, "Wrong code").into_response(),
        CodeCheck::Gone => (StatusCode::GONE, "This code has expired. Request a new one.").into_response(),
    }
}

fn phone_name(raw: &str) -> String {
    let name: String = raw.trim().chars().take(64).collect();
    if name.is_empty() { "Phone".into() } else { name }
}

/// Stores a new phone and replies `{ token, id, name, hosts, port }`: the phone's own token plus
/// what the QR would have told it, since pairing by code has no QR.
fn add_phone(app: &App, name: &str) -> Response {
    let phone = Phone::new(phone_name(name));
    let reply = {
        let mut settings = app.settings();
        settings.phones.push(phone.clone());
        let (hosts, desktop_name) = pairing_info(&settings);
        serde_json::json!({
            "token": phone.token, "id": settings.id, "name": desktop_name, "hosts": hosts, "port": settings.port,
        })
    };
    match app.save_settings() {
        Ok(()) => Json(reply).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

/// `GET /info` -> `{ id, name }`, so the web app can tell which desktop served it before pairing.
async fn info(State(app): State<Arc<App>>) -> Json<serde_json::Value> {
    let settings = app.settings();
    let (_, name) = pairing_info(&settings);
    Json(serde_json::json!({ "id": settings.id, "name": name }))
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Library media, oldest first like the camera (the phone reverses the list).
async fn images(State(app): State<Arc<App>>, req: Request) -> Json<Vec<ImageItem>> {
    let token = query_param(&req, "t");
    let library = app.settings().library.clone();
    // Build URLs against whatever address the phone reached us on (LAN IP, VPN name, ...).
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("localhost");
    let tls = req.extensions().get::<ConnectInfo<Peer>>().is_some_and(|c| c.0.tls);
    let scheme = if tls { "https" } else { "http" };
    let base = url::Url::parse(&format!("{scheme}://{host}/")).unwrap_or_else(|_| "http://localhost/".parse().unwrap());
    let items = library_files(&library)
        .into_iter()
        .filter_map(|path| {
            // ["2025-06-14", "DSC00001.JPG"], or just the name for a top-level file.
            let parts: Vec<String> = path
                .strip_prefix(&library)
                .ok()?
                .components()
                .map(|c| c.as_os_str().to_str().map(String::from))
                .collect::<Option<_>>()?;
            let link = |route: &str| {
                let mut u = base.clone();
                u.path_segments_mut().unwrap().pop_if_empty().push(route).extend(&parts);
                u.query_pairs_mut().append_pair("t", &token);
                u.to_string()
            };
            Some(ImageItem {
                title: parts.last()?.clone(),
                url: link("files"),
                thumbnail_url: link("thumbs"),
                // The phone saves by this name, so it carries the date to stay unique.
                filename: parts.join("_"),
            })
        })
        .collect();
    Json(items)
}

fn is_hidden(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

/// Library media, oldest first: the date folders' files plus top-level ones (synced before
/// per-date folders). An AVCHD clip is left out once its converted `.mp4` exists.
pub fn library_files(library: &Path) -> Vec<PathBuf> {
    let entries = |dir: &Path| fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect::<Vec<_>>();
    let mut files: Vec<_> = entries(library)
        .into_iter()
        .flat_map(|p| if p.is_dir() && !is_hidden(&p) { entries(&p) } else { vec![p] })
        .filter(|p| p.is_file() && import::is_media(p))
        .filter(|p| !(import::is_mts(p) && p.with_extension("mp4").exists()))
        .filter_map(|p| Some((fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    files.sort();
    files.into_iter().map(|(_, p)| p).collect()
}

/// Where a library file's thumbnail is cached.
pub fn library_thumb(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(".thumbs").join(format!("{name}.jpg"))
}

/// Resolves a URL path (`DSC00001.JPG` or `2025-06-14/DSC00001.JPG`) inside the library,
/// rejecting anything that could escape it or reach hidden files like `.thumbs`.
fn library_path(library: &Path, rel: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = rel.split('/').collect();
    let ok = parts.len() <= 2
        && parts.iter().all(|p| !p.is_empty() && !p.starts_with('.') && !p.contains(['\\', ':']))
        && import::is_media(Path::new(rel));
    ok.then(|| library.join(rel))
}

/// Served with HTTP Range support, so large videos can resume.
async fn file(State(app): State<Arc<App>>, UrlPath(rel): UrlPath<String>, req: Request) -> Response {
    let library = app.settings().library.clone();
    match library_path(&library, &rel) {
        Some(path) => ServeFile::new(path).oneshot(req).await.into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn thumb(State(app): State<Arc<App>>, UrlPath(rel): UrlPath<String>, req: Request) -> Response {
    let library = app.settings().library.clone();
    let Some(path) = library_path(&library, &rel) else { return StatusCode::NOT_FOUND.into_response() };
    let out = library_thumb(&path);
    let job = (path, out.clone());
    let ok = tokio::task::spawn_blocking(move || thumbs::thumbnail(&job.0, &job.1)).await.unwrap_or(false);
    if ok {
        ServeFile::new(out).oneshot(req).await.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_pairing() {
        let now = Instant::now();
        let fresh = || {
            let r = PairRequest::new("p".into());
            assert!(r.code.len() == 6 && r.code.bytes().all(|b| b.is_ascii_digit()));
            let id = r.id.clone();
            let code = r.code.clone();
            (Some(r), id, code)
        };
        let wrong = |code: &str| if code == "000000" { "000001" } else { "000000" }.to_string();

        let (mut p, id, code) = fresh();
        assert_eq!(check_code(&mut p, "other", &code, now), CodeCheck::Gone);
        assert_eq!(check_code(&mut p, &id, &code, now), CodeCheck::Ok);
        assert_eq!(check_code(&mut p, &id, &code, now), CodeCheck::Gone, "single use");

        let (mut p, id, code) = fresh();
        for _ in 0..CODE_ATTEMPTS {
            assert_eq!(check_code(&mut p, &id, &wrong(&code), now), CodeCheck::Wrong);
        }
        assert_eq!(check_code(&mut p, &id, &code, now), CodeCheck::Gone, "out of attempts");

        let (mut p, id, code) = fresh();
        let expires = p.as_ref().unwrap().expires;
        assert_eq!(check_code(&mut p, &id, &code, expires), CodeCheck::Gone, "expired");
    }

    #[test]
    fn lists_date_folders_and_rejects_escapes() {
        let library = std::env::temp_dir().join(format!("image-sync-test-{}", uuid::Uuid::new_v4()));
        for rel in ["OLD.JPG", "2025-06-14/DSC00001.JPG", "2025-06-14/00000.MTS", "2025-06-14/00000.mp4",
            "2025-06-14/00001.MTS", "2025-06-14/.thumbs/DSC00001.JPG.jpg", ".thumbs/OLD.JPG.jpg"] {
            let p = library.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"x").unwrap();
        }
        let mut names: Vec<_> =
            library_files(&library).iter().map(|p| p.strip_prefix(&library).unwrap().to_owned()).collect();
        names.sort();
        let expected: Vec<PathBuf> =
            ["2025-06-14/00000.mp4", "2025-06-14/00001.MTS", "2025-06-14/DSC00001.JPG", "OLD.JPG"].map(PathBuf::from).into();
        assert_eq!(names, expected);

        assert!(library_path(&library, "2025-06-14/DSC00001.JPG").is_some());
        assert!(library_path(&library, "OLD.JPG").is_some());
        for bad in ["../x.JPG", "2025-06-14/../../x.JPG", ".thumbs/OLD.JPG.jpg", "a/b/c.JPG", "/etc.JPG", "C:x.JPG", "a\\b.JPG"] {
            assert!(library_path(&library, bad).is_none(), "{bad}");
        }
        fs::remove_dir_all(library).unwrap();
    }
}
