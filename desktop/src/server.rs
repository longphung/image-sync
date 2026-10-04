//! HTTP API the mobile app pulls from. Same `ImageItem` JSON shape as `src/camera/types.ts`.
//! Every request needs the phone's own token (from `POST /pair`) as a `t=` query parameter; the
//! URLs returned by `/images` already include it, so the phone's image/video/download code needs
//! no headers.

use crate::{import, new_token, thumbs, App, Phone};
use axum::extract::{Path as UrlPath, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower::ServiceExt;
use tower_http::services::ServeFile;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageItem {
    title: String,
    url: String,
    filename: String,
    thumbnail_url: String,
}

pub async fn serve(app: Arc<App>, port: u16) -> std::io::Result<()> {
    let router = Router::new()
        .route("/images", get(images))
        .route("/files/{*path}", get(file))
        .route("/thumbs/{*path}", get(thumb))
        .layer(middleware::from_fn_with_state(app.clone(), auth))
        // Checks the pairing token itself; added after the layer so `auth` doesn't cover it.
        .route("/pair", post(pair))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    axum::serve(listener, router).await
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

/// `POST /pair?t=<pairing token from the QR>&name=<phone name>` returns `{ "token": ... }`, the
/// phone's own token. The pairing token is replaced at once, so a QR is only good for one phone
/// and a photo of an old one is useless.
async fn pair(State(app): State<Arc<App>>, req: Request) -> Response {
    let phone = {
        let mut settings = app.settings();
        if !constant_time_eq(&query_param(&req, "t"), &settings.token) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        let name: String = query_param(&req, "name").trim().chars().take(64).collect();
        let phone = Phone::new(if name.is_empty() { "Phone".into() } else { name });
        settings.token = new_token();
        settings.phones.push(phone.clone());
        phone
    };
    match app.save_settings() {
        Ok(()) => Json(serde_json::json!({ "token": phone.token })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
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
    let base = url::Url::parse(&format!("http://{host}/")).unwrap_or_else(|_| "http://localhost/".parse().unwrap());
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
