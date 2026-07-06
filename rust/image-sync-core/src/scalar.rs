use crate::error::CoreError;
use crate::types::ImageItem;

const BATCH: u64 = 50;

#[derive(serde::Serialize)]
struct RpcRequest<'a> {
    method: &'a str,
    params: Vec<serde_json::Value>,
    id: u64,
    version: &'a str,
}

#[derive(serde::Deserialize)]
struct RpcResponse {
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<Vec<serde_json::Value>>,
}

/// Walk every scheme/source on a Scalar Web API camera and return all still
/// images found, mirroring `SonyCamera.list_all_images`.
pub fn list_images_scalar(base_url: &str) -> Result<Vec<ImageItem>, CoreError> {
    let mut rpc_id = 1u64;
    let mut results = Vec::new();
    for scheme in get_scheme_list(base_url, &mut rpc_id)? {
        for source in get_source_list(base_url, &scheme, &mut rpc_id)? {
            for item in get_all_content(base_url, &source, &mut rpc_id)? {
                results.push(content_item_to_image_item(&item));
            }
        }
    }
    Ok(results)
}

fn call(
    base_url: &str,
    method: &str,
    params: Vec<serde_json::Value>,
    version: &str,
    rpc_id: &mut u64,
) -> Result<serde_json::Value, CoreError> {
    let url = format!("{}/avContent", base_url.trim_end_matches('/'));
    let body = RpcRequest {
        method,
        params,
        id: *rpc_id,
        version,
    };
    *rpc_id += 1;

    let resp: RpcResponse = ureq::post(&url)
        .header("Content-Type", "application/json")
        .send_json(&body)
        .map_err(|e| CoreError::JsonRpc(format!("{url}: {e}")))?
        .body_mut()
        .read_json()
        .map_err(|e| CoreError::JsonRpc(format!("{url}: {e}")))?;

    if let Some(err) = resp.error {
        let code = err.first().and_then(|v| v.as_i64()).unwrap_or(-1);
        let msg = err
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return Err(CoreError::JsonRpc(format!("API error {code}: {msg}")));
    }

    Ok(resp.result.unwrap_or(serde_json::Value::Array(vec![])))
}

fn get_scheme_list(base_url: &str, rpc_id: &mut u64) -> Result<Vec<String>, CoreError> {
    let result = call(base_url, "getSchemeList", vec![], "1.0", rpc_id)?;
    Ok(result
        .get(0)
        .and_then(|v| v.as_array())
        .map(|schemes| {
            schemes
                .iter()
                .filter_map(|s| s.get("scheme").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

fn get_source_list(
    base_url: &str,
    scheme: &str,
    rpc_id: &mut u64,
) -> Result<Vec<String>, CoreError> {
    let params = vec![serde_json::json!({ "scheme": scheme })];
    let result = call(base_url, "getSourceList", params, "1.0", rpc_id)?;
    Ok(result
        .get(0)
        .and_then(|v| v.as_array())
        .map(|sources| {
            sources
                .iter()
                .filter_map(|s| s.get("source").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

fn get_content_count(base_url: &str, uri: &str, rpc_id: &mut u64) -> Result<u64, CoreError> {
    let params = vec![serde_json::json!({ "uri": uri, "type": ["still"], "target": "all" })];
    let result = call(base_url, "getContentCount", params, "1.2", rpc_id)?;
    Ok(result
        .get(0)
        .and_then(|v| v.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0))
}

fn get_content_list(
    base_url: &str,
    uri: &str,
    start: u64,
    count: u64,
    rpc_id: &mut u64,
) -> Result<Vec<serde_json::Value>, CoreError> {
    let count = count.min(BATCH);
    let params = vec![serde_json::json!({
        "uri": uri,
        "stIdx": start,
        "cnt": count,
        "type": ["still"],
        "target": "all",
        "view": "date",
        "sort": "ascending",
    })];
    let result = call(base_url, "getContentList", params, "1.3", rpc_id)?;
    Ok(result
        .get(0)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

fn get_all_content(
    base_url: &str,
    uri: &str,
    rpc_id: &mut u64,
) -> Result<Vec<serde_json::Value>, CoreError> {
    let total = get_content_count(base_url, uri, rpc_id)?;
    let mut items = Vec::new();
    let mut start = 0u64;
    while start < total {
        let batch = BATCH.min(total - start);
        items.extend(get_content_list(base_url, uri, start, batch, rpc_id)?);
        start += batch;
    }
    Ok(items)
}

/// Extract `{title, url, filename, thumbnail_url}` from a single
/// `getContentList` entry, preferring the original full-resolution file and
/// falling back through `largeUrl` → `thumbnailUrl`, and the title when no
/// filename is otherwise available.
pub(crate) fn content_item_to_image_item(item: &serde_json::Value) -> ImageItem {
    let title = item
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let content = item.get("content").cloned().unwrap_or_default();
    let orig = content
        .get("original")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first());
    let orig_url = orig
        .and_then(|o| o.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let large_url = content
        .get("largeUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let thumb_url = content
        .get("thumbnailUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let url = if !orig_url.is_empty() {
        orig_url
    } else if !large_url.is_empty() {
        large_url
    } else {
        &thumb_url
    };

    let orig_filename = orig
        .and_then(|o| o.get("fileName"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let filename = if !orig_filename.is_empty() {
        orig_filename.to_string()
    } else {
        let path_only = url.split('?').next().unwrap_or(url);
        std::path::Path::new(path_only)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| title.clone())
    };

    ImageItem {
        title,
        url: url.to_string(),
        filename,
        thumbnail_url: thumb_url,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_item_to_image_item_uses_original_when_present() {
        let item = serde_json::json!({
            "title": "2026-01-01 12:00:00+0000",
            "content": {
                "original": [{ "url": "http://cam/ORG_DSC01309.JPG", "fileName": "ORG_DSC01309.JPG" }],
                "largeUrl": "http://cam/large.jpg",
                "thumbnailUrl": "http://cam/thumb.jpg",
            }
        });
        let result = content_item_to_image_item(&item);
        assert_eq!(result.url, "http://cam/ORG_DSC01309.JPG");
        assert_eq!(result.filename, "ORG_DSC01309.JPG");
        assert_eq!(result.thumbnail_url, "http://cam/thumb.jpg");
    }

    #[test]
    fn content_item_to_image_item_falls_back_to_large_url_then_thumbnail_url() {
        let item = serde_json::json!({
            "title": "t",
            "content": { "largeUrl": "http://cam/large.jpg", "thumbnailUrl": "http://cam/thumb.jpg" }
        });
        let result = content_item_to_image_item(&item);
        assert_eq!(result.url, "http://cam/large.jpg");

        let item_only_thumb = serde_json::json!({
            "title": "t",
            "content": { "thumbnailUrl": "http://cam/thumb.jpg" }
        });
        let result = content_item_to_image_item(&item_only_thumb);
        assert_eq!(result.url, "http://cam/thumb.jpg");
    }

    #[test]
    fn content_item_to_image_item_falls_back_to_title_when_no_filename_available() {
        let item = serde_json::json!({
            "title": "MyPhoto",
            "content": { "thumbnailUrl": "" }
        });
        let result = content_item_to_image_item(&item);
        assert_eq!(result.filename, "MyPhoto");
    }
}
