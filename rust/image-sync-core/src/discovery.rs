use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::error::CoreError;
use crate::types::{CameraApi, CameraInfo};
use crate::xml::{is_local, read_element_text};

/// The camera is always the DHCP gateway at this fixed IP once joined to its
/// Wi-Fi access point in "Send to Smartphone" mode — no SSDP/UDP discovery is
/// needed. Callers can override this with a manual IP for cameras that use a
/// different gateway address.
pub const DEFAULT_HOST: &str = "192.168.122.1";
const DEVICE_DESCRIPTION_PORT: u16 = 64321;

/// Fetch and classify the camera's device description (`DmsDesc.xml`) at
/// `host` (falling back to [`DEFAULT_HOST`] when `None`).
pub fn get_camera_info(host: Option<&str>) -> Result<CameraInfo, CoreError> {
    let host = host.unwrap_or(DEFAULT_HOST);
    let dd_url = format!("http://{host}:{DEVICE_DESCRIPTION_PORT}/DmsDesc.xml");
    let xml_text = ureq::get(&dd_url)
        .call()
        .map_err(|e| CoreError::Http(format!("GET {dd_url}: {e}")))?
        .body_mut()
        .read_to_string()
        .map_err(|e| CoreError::Http(format!("GET {dd_url}: {e}")))?;
    parse_device_description(&xml_text, &dd_url)
}

/// Parse a device description document and classify it as Scalar Web API or
/// DLNA ContentDirectory. Scalar is preferred when both are somehow present,
/// matching the reference client's precedence.
pub(crate) fn parse_device_description(
    xml_text: &str,
    dd_url: &str,
) -> Result<CameraInfo, CoreError> {
    let mut reader = Reader::from_str(xml_text);

    let mut scalar_base_url: Option<String> = None;
    let mut dlna_control_url: Option<String> = None;
    let mut photo_root: Option<String> = None;
    let mut friendly_name: Option<String> = None;
    let mut model_name: Option<String> = None;

    let mut current_service_is_content_directory = false;
    let mut pending_control_url: Option<String> = None;

    loop {
        match reader.read_event().map_err(CoreError::from)? {
            Event::Start(e) if is_local(e.name(), "X_ScalarWebAPI_ActionList_URL") => {
                let text = read_element_text(&mut reader)?.trim().to_string();
                if !text.is_empty() {
                    scalar_base_url = Some(text.trim_end_matches('/').to_string());
                }
            }

            Event::Start(e) if is_local(e.name(), "service") => {
                current_service_is_content_directory = false;
                pending_control_url = None;
            }
            Event::Start(e) if is_local(e.name(), "serviceType") => {
                let text = read_element_text(&mut reader)?;
                if text.contains("ContentDirectory") {
                    current_service_is_content_directory = true;
                }
            }
            Event::Start(e) if is_local(e.name(), "controlURL") => {
                let text = read_element_text(&mut reader)?.trim().to_string();
                pending_control_url = Some(text);
            }
            Event::End(e) if is_local(e.name(), "service") => {
                if current_service_is_content_directory && dlna_control_url.is_none() {
                    if let Some(ctrl) = pending_control_url.take() {
                        if !ctrl.is_empty() {
                            let base = origin(dd_url);
                            dlna_control_url = Some(format!("{base}{ctrl}"));
                        }
                    }
                }
            }

            Event::Start(e) if is_local(e.name(), "photoRoot") => {
                let text = read_element_text(&mut reader)?.trim().to_string();
                if !text.is_empty() {
                    photo_root = Some(text);
                }
            }

            // First occurrence wins, so an embedded sub-device can't override the root's name.
            Event::Start(e) if is_local(e.name(), "friendlyName") && friendly_name.is_none() => {
                friendly_name = non_empty(read_element_text(&mut reader)?);
            }
            Event::Start(e) if is_local(e.name(), "modelName") && model_name.is_none() => {
                model_name = non_empty(read_element_text(&mut reader)?);
            }

            Event::Eof => break,
            _ => {}
        }
    }

    let api = if let Some(base_url) = scalar_base_url {
        CameraApi::Scalar { base_url }
    } else if let Some(control_url) = dlna_control_url {
        CameraApi::Dlna {
            control_url,
            photo_root: photo_root.unwrap_or_else(|| "0".to_string()),
        }
    } else {
        return Err(CoreError::UnrecognizedDevice(dd_url.to_string()));
    };

    Ok(CameraInfo {
        api,
        name: friendly_name.or(model_name),
    })
}

fn non_empty(text: String) -> Option<String> {
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Extract the `scheme://host[:port]` origin from a URL, for joining against
/// a relative `controlURL`.
fn origin(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let after_scheme = scheme_end + 3;
        if let Some(rel) = url[after_scheme..].find('/') {
            return url[..after_scheme + rel].to_string();
        }
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DD_URL: &str = "http://192.168.122.1:64321/DmsDesc.xml";

    #[test]
    fn parses_dlna_device_description_and_joins_control_url() {
        let xml = r#"<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:av="urn:schemas-sony-com:av">
  <device>
    <av:photoRoot>PhotoRoot</av:photoRoot>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>/upnp/control/ContentDirectory</controlURL>
      </service>
    </serviceList>
  </device>
</root>"#;
        let api = parse_device_description(xml, DD_URL).unwrap().api;
        assert_eq!(
            api,
            CameraApi::Dlna {
                control_url: "http://192.168.122.1:64321/upnp/control/ContentDirectory".to_string(),
                photo_root: "PhotoRoot".to_string(),
            }
        );
    }

    #[test]
    fn parses_scalar_device_description() {
        let xml = r#"<?xml version="1.0"?>
<root>
  <device>
    <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony/</X_ScalarWebAPI_ActionList_URL>
  </device>
</root>"#;
        let api = parse_device_description(xml, DD_URL).unwrap().api;
        assert_eq!(
            api,
            CameraApi::Scalar {
                base_url: "http://192.168.122.1:10000/sony".to_string(),
            }
        );
    }

    #[test]
    fn scalar_is_preferred_when_both_present() {
        let xml = r#"<?xml version="1.0"?>
<root>
  <device>
    <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony</X_ScalarWebAPI_ActionList_URL>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>/upnp/control/ContentDirectory</controlURL>
      </service>
    </serviceList>
  </device>
</root>"#;
        let api = parse_device_description(xml, DD_URL).unwrap().api;
        assert!(matches!(api, CameraApi::Scalar { .. }));
    }

    #[test]
    fn unrecognized_device_returns_error() {
        let xml = r#"<?xml version="1.0"?><root><device><friendlyName>Nope</friendlyName></device></root>"#;
        let err = parse_device_description(xml, DD_URL).unwrap_err();
        assert!(matches!(err, CoreError::UnrecognizedDevice(_)));
    }

    #[test]
    fn defaults_photo_root_to_zero_when_missing() {
        let xml = r#"<?xml version="1.0"?>
<root>
  <device>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>/upnp/control/ContentDirectory</controlURL>
      </service>
    </serviceList>
  </device>
</root>"#;
        let api = parse_device_description(xml, DD_URL).unwrap().api;
        assert_eq!(
            api,
            CameraApi::Dlna {
                control_url: "http://192.168.122.1:64321/upnp/control/ContentDirectory".to_string(),
                photo_root: "0".to_string(),
            }
        );
    }

    #[test]
    fn extracts_friendly_name_with_entities_and_falls_back_to_model_name() {
        let xml = r#"<?xml version="1.0"?>
<root>
  <device>
    <friendlyName>Sony &amp; Co RX100M3</friendlyName>
    <modelName>DSC-RX100M3</modelName>
    <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony</X_ScalarWebAPI_ActionList_URL>
  </device>
</root>"#;
        let info = parse_device_description(xml, DD_URL).unwrap();
        assert_eq!(info.name.as_deref(), Some("Sony & Co RX100M3"));

        let xml = r#"<?xml version="1.0"?>
<root>
  <device>
    <friendlyName>  </friendlyName>
    <modelName>DSC-RX100M3</modelName>
    <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony</X_ScalarWebAPI_ActionList_URL>
  </device>
</root>"#;
        let info = parse_device_description(xml, DD_URL).unwrap();
        assert_eq!(info.name.as_deref(), Some("DSC-RX100M3"));
    }
}
