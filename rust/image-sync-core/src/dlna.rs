use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::error::CoreError;
use crate::types::ImageItem;
use crate::xml::{attr_value, is_local, read_element_text, unescape_xml_entities_once};

const BROWSE_BATCH: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DidlRes {
    pub(crate) url: String,
    pub(crate) protocol_info: String,
    pub(crate) size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DidlItem {
    pub(crate) title: String,
    pub(crate) res: Vec<DidlRes>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DidlNode {
    Container { id: String },
    Item(DidlItem),
}

/// Recursively browse the container tree from `photo_root`, collecting every
/// `<item>` and resolving each to an [`ImageItem`].
pub fn list_images_dlna(control_url: &str, photo_root: &str) -> Result<Vec<ImageItem>, CoreError> {
    let items = collect_items(control_url, photo_root)?;
    Ok(items.into_iter().map(build_image_item).collect())
}

fn browse_soap_envelope(object_id: &str, start: usize, count: usize) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
<s:Body>\
<u:Browse xmlns:u=\"urn:schemas-upnp-org:service:ContentDirectory:1\">\
<ObjectID>{object_id}</ObjectID>\
<BrowseFlag>BrowseDirectChildren</BrowseFlag>\
<Filter>*</Filter>\
<StartingIndex>{start}</StartingIndex>\
<RequestedCount>{count}</RequestedCount>\
<SortCriteria></SortCriteria>\
</u:Browse>\
</s:Body>\
</s:Envelope>"
    )
}

fn send_browse_request(
    control_url: &str,
    object_id: &str,
    start: usize,
    count: usize,
) -> Result<String, CoreError> {
    let body = browse_soap_envelope(object_id, start, count);
    ureq::post(control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header(
            "SOAPAction",
            "\"urn:schemas-upnp-org:service:ContentDirectory:1#Browse\"",
        )
        .send(body.as_bytes())
        .map_err(|e| CoreError::Soap(format!("Browse({object_id}) failed: {e}")))?
        .body_mut()
        .read_to_string()
        .map_err(|e| CoreError::Soap(format!("Browse({object_id}) failed to read response: {e}")))
}

/// Parse one SOAP Browse response: the `TotalMatches` count, and the
/// `Result` element's nested (doubly-escaped) DIDL-Lite content, if present.
pub(crate) fn parse_browse_response(
    raw: &str,
) -> Result<(Option<Vec<DidlNode>>, usize), CoreError> {
    let mut reader = Reader::from_str(raw);

    let mut total = 0usize;
    let mut result_text: Option<String> = None;

    loop {
        match reader.read_event().map_err(CoreError::from)? {
            Event::Start(e) if is_local(e.name(), "TotalMatches") => {
                let text = read_element_text(&mut reader)?;
                total = text.trim().parse().unwrap_or(0);
            }
            Event::Start(e) if is_local(e.name(), "Result") => {
                let once = read_element_text(&mut reader)?;
                result_text = Some(unescape_xml_entities_once(&once));
            }
            Event::Eof => break,
            _ => {}
        }
    }

    match result_text {
        None => Ok((None, total)),
        Some(didl_xml) => Ok((Some(parse_didl(&didl_xml)?), total)),
    }
}

fn browse_all_children(control_url: &str, object_id: &str) -> Result<Vec<DidlNode>, CoreError> {
    let mut children = Vec::new();
    let mut start = 0usize;
    loop {
        let raw = send_browse_request(control_url, object_id, start, BROWSE_BATCH)?;
        let (nodes, total) = parse_browse_response(&raw)?;
        let Some(mut batch) = nodes else { break };
        if batch.is_empty() {
            break;
        }
        start += batch.len();
        children.append(&mut batch);
        if start >= total {
            break;
        }
    }
    Ok(children)
}

fn collect_items(control_url: &str, object_id: &str) -> Result<Vec<DidlItem>, CoreError> {
    let mut items = Vec::new();
    for node in browse_all_children(control_url, object_id)? {
        match node {
            DidlNode::Item(item) => items.push(item),
            DidlNode::Container { id } if !id.is_empty() => {
                items.extend(collect_items(control_url, &id)?);
            }
            DidlNode::Container { .. } => {}
        }
    }
    Ok(items)
}

fn find_attr(e: &BytesStart, name: &str) -> Result<Option<String>, CoreError> {
    for attr in e.attributes() {
        let attr = attr.map_err(|err| CoreError::XmlParse(err.to_string()))?;
        if attr.key.local_name().as_ref() == name.as_bytes() {
            return Ok(Some(attr_value(&attr)?));
        }
    }
    Ok(None)
}

/// Parse the direct children of a DIDL-Lite document's root: one entry per
/// `<container>` (just its `id`) or `<item>` (title + all `<res>` entries).
pub(crate) fn parse_didl(xml: &str) -> Result<Vec<DidlNode>, CoreError> {
    let mut reader = Reader::from_str(xml);

    let mut nodes = Vec::new();
    let mut current_item: Option<DidlItem> = None;

    loop {
        match reader.read_event().map_err(CoreError::from)? {
            Event::Start(e) if is_local(e.name(), "container") && current_item.is_none() => {
                let id = find_attr(&e, "id")?.unwrap_or_default();
                nodes.push(DidlNode::Container { id });
            }
            Event::Empty(e) if is_local(e.name(), "container") && current_item.is_none() => {
                let id = find_attr(&e, "id")?.unwrap_or_default();
                nodes.push(DidlNode::Container { id });
            }

            Event::Start(e) if is_local(e.name(), "item") => {
                current_item = Some(DidlItem {
                    title: String::new(),
                    res: Vec::new(),
                });
            }

            Event::Start(e) if is_local(e.name(), "title") && current_item.is_some() => {
                let text = read_element_text(&mut reader)?.trim().to_string();
                if let Some(item) = current_item.as_mut() {
                    item.title = text;
                }
            }

            Event::Start(e) if is_local(e.name(), "res") && current_item.is_some() => {
                let protocol_info = find_attr(&e, "protocolInfo")?.unwrap_or_default();
                let size = find_attr(&e, "size")?
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let url = read_element_text(&mut reader)?.trim().to_string();
                if let Some(item) = current_item.as_mut() {
                    item.res.push(DidlRes {
                        url,
                        protocol_info,
                        size,
                    });
                }
            }
            Event::Empty(e) if is_local(e.name(), "res") && current_item.is_some() => {
                let protocol_info = find_attr(&e, "protocolInfo")?.unwrap_or_default();
                let size = find_attr(&e, "size")?
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                if let Some(item) = current_item.as_mut() {
                    item.res.push(DidlRes {
                        url: String::new(),
                        protocol_info,
                        size,
                    });
                }
            }

            Event::End(e) if is_local(e.name(), "item") => {
                if let Some(item) = current_item.take() {
                    nodes.push(DidlNode::Item(item));
                }
            }

            Event::Eof => break,
            _ => {}
        }
    }

    Ok(nodes)
}

/// Prefer the `<res>` with no `DLNA.ORG_PN=` in its `protocolInfo` (the
/// original, full-resolution file), keeping the largest by `size` if there
/// are several. Falls back to the first converted (thumbnail/small/large)
/// resource in document order if no original is present — a faithful port
/// of the reference client's behavior, not "fixed" to pick the largest
/// fallback, since that's what has been validated against real hardware.
pub(crate) fn pick_original_res(res_list: &[DidlRes]) -> (String, String) {
    let mut original_url = String::new();
    let mut original_size: i64 = -1;
    let mut fallback_url = String::new();

    for res in res_list {
        if res.url.is_empty() {
            continue;
        }
        if !res.protocol_info.contains("DLNA.ORG_PN=") {
            if res.size as i64 > original_size {
                original_size = res.size as i64;
                original_url = res.url.clone();
            }
        } else if fallback_url.is_empty() {
            fallback_url = res.url.clone();
        }
    }

    let url = if !original_url.is_empty() {
        original_url
    } else {
        fallback_url
    };

    let filename = if url.is_empty() {
        String::new()
    } else {
        let path_only = url.split('?').next().unwrap_or(&url);
        std::path::Path::new(path_only)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    };

    (url, filename)
}

pub(crate) fn thumbnail_url(res_list: &[DidlRes]) -> String {
    res_list
        .iter()
        .find(|r| r.protocol_info.contains("JPEG_TN"))
        .map(|r| r.url.clone())
        .unwrap_or_default()
}

fn build_image_item(item: DidlItem) -> ImageItem {
    let (url, filename) = pick_original_res(&item.res);
    let thumb = thumbnail_url(&item.res);
    let filename = if filename.is_empty() {
        item.title.clone()
    } else {
        filename
    };
    ImageItem {
        title: item.title,
        url,
        filename,
        thumbnail_url: thumb,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res(url: &str, protocol_info: &str, size: u64) -> DidlRes {
        DidlRes {
            url: url.to_string(),
            protocol_info: protocol_info.to_string(),
            size,
        }
    }

    #[test]
    fn pick_original_res_prefers_original_over_converted() {
        let list = vec![
            res(
                "http://cam/thumb.jpg",
                "http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN",
                1000,
            ),
            res(
                "http://cam/large.jpg",
                "http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG",
                50000,
            ),
            res(
                "http://cam/ORG_DSC01309.JPG",
                "http-get:*:image/jpeg:*",
                4_500_000,
            ),
        ];
        let (url, filename) = pick_original_res(&list);
        assert_eq!(url, "http://cam/ORG_DSC01309.JPG");
        assert_eq!(filename, "ORG_DSC01309.JPG");
    }

    #[test]
    fn pick_original_res_falls_back_to_first_converted_when_no_original() {
        let list = vec![
            res(
                "http://cam/thumb.jpg",
                "http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN",
                1000,
            ),
            res(
                "http://cam/large.jpg",
                "http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG",
                50000,
            ),
        ];
        let (url, _) = pick_original_res(&list);
        assert_eq!(url, "http://cam/thumb.jpg");
    }

    #[test]
    fn pick_original_res_picks_largest_among_multiple_originals() {
        let list = vec![
            res("http://cam/a.jpg", "http-get:*:image/jpeg:*", 100),
            res("http://cam/b.jpg", "http-get:*:image/jpeg:*", 200),
        ];
        let (url, _) = pick_original_res(&list);
        assert_eq!(url, "http://cam/b.jpg");
    }

    #[test]
    fn thumbnail_url_finds_jpeg_tn() {
        let list = vec![res(
            "http://cam/thumb.jpg",
            "http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN",
            1000,
        )];
        assert_eq!(thumbnail_url(&list), "http://cam/thumb.jpg");
        assert_eq!(thumbnail_url(&[]), "");
    }

    #[test]
    fn parse_didl_extracts_items_and_containers() {
        let xml = r#"<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/">
<container id="1" childCount="3"/>
<item id="2" parentID="1">
  <dc:title>ORG_DSC01309</dc:title>
  <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN">http://cam/thumb.jpg</res>
  <res protocolInfo="http-get:*:image/jpeg:*" size="4500000">http://cam/ORG_DSC01309.JPG</res>
</item>
</DIDL-Lite>"#;
        let nodes = parse_didl(xml).unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(
            nodes[0],
            DidlNode::Container {
                id: "1".to_string()
            }
        );
        match &nodes[1] {
            DidlNode::Item(item) => {
                assert_eq!(item.title, "ORG_DSC01309");
                assert_eq!(item.res.len(), 2);
                assert_eq!(item.res[1].url, "http://cam/ORG_DSC01309.JPG");
                assert_eq!(item.res[1].size, 4_500_000);
            }
            other => panic!("expected item, got {other:?}"),
        }
    }

    #[test]
    fn parse_browse_response_handles_double_escaped_result() {
        // The real DIDL-Lite document is:
        //   <DIDL-Lite ...><item id="2"><dc:title>Sample &amp; Title</dc:title>
        //   <res protocolInfo="..." size="123">http://cam/ORG.JPG</res></item></DIDL-Lite>
        // That document is escaped once to become well-formed SOAP `<Result>`
        // text, then escaped a *second* time (every `&` in the once-escaped
        // text becomes `&amp;`) because that's what the reference client's
        // `html.unescape()`-after-ElementTree-parse behavior implies about
        // the real camera's wire format. quick-xml's automatic unescape on
        // `<Result>`'s text undoes the outer envelope's escaping (pass 1,
        // recovering the once-escaped text below); `unescape_xml_entities_once`
        // must undo the second layer (pass 2) to recover the real document.
        let raw = r#"<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
<s:Body>
<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
<Result>&amp;lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"&amp;gt;&amp;lt;item id="2"&amp;gt;&amp;lt;dc:title&amp;gt;Sample &amp;amp;amp; Title&amp;lt;/dc:title&amp;gt;&amp;lt;res protocolInfo="http-get:*:image/jpeg:*" size="123"&amp;gt;http://cam/ORG.JPG&amp;lt;/res&amp;gt;&amp;lt;/item&amp;gt;&amp;lt;/DIDL-Lite&amp;gt;</Result>
<NumberReturned>1</NumberReturned>
<TotalMatches>1</TotalMatches>
</u:BrowseResponse>
</s:Body>
</s:Envelope>"#;
        let (nodes, total) = parse_browse_response(raw).unwrap();
        assert_eq!(total, 1);
        let nodes = nodes.expect("expected parsed DIDL nodes");
        assert_eq!(nodes.len(), 1);
        match &nodes[0] {
            DidlNode::Item(item) => {
                assert_eq!(item.title, "Sample & Title");
                assert_eq!(item.res[0].url, "http://cam/ORG.JPG");
                assert_eq!(item.res[0].size, 123);
            }
            other => panic!("expected item, got {other:?}"),
        }
    }
}
