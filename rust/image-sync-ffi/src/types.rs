#[derive(uniffi::Record)]
pub struct ImageItem {
    pub title: String,
    pub url: String,
    pub filename: String,
    pub thumbnail_url: String,
}

impl From<image_sync_core::ImageItem> for ImageItem {
    fn from(i: image_sync_core::ImageItem) -> Self {
        Self {
            title: i.title,
            url: i.url,
            filename: i.filename,
            thumbnail_url: i.thumbnail_url,
        }
    }
}

#[derive(uniffi::Enum)]
pub enum CameraApi {
    Dlna {
        control_url: String,
        photo_root: String,
    },
    Scalar {
        base_url: String,
    },
}

impl From<image_sync_core::CameraApi> for CameraApi {
    fn from(a: image_sync_core::CameraApi) -> Self {
        match a {
            image_sync_core::CameraApi::Dlna {
                control_url,
                photo_root,
            } => Self::Dlna {
                control_url,
                photo_root,
            },
            image_sync_core::CameraApi::Scalar { base_url } => Self::Scalar { base_url },
        }
    }
}

impl From<CameraApi> for image_sync_core::CameraApi {
    fn from(a: CameraApi) -> Self {
        match a {
            CameraApi::Dlna {
                control_url,
                photo_root,
            } => Self::Dlna {
                control_url,
                photo_root,
            },
            CameraApi::Scalar { base_url } => Self::Scalar { base_url },
        }
    }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum CameraError {
    #[error("HTTP request failed: {0}")]
    Http(String),
    #[error("XML parse error: {0}")]
    XmlParse(String),
    #[error("unrecognized camera device: {0}")]
    UnrecognizedDevice(String),
    #[error("SOAP error: {0}")]
    Soap(String),
    #[error("Scalar JSON-RPC error: {0}")]
    JsonRpc(String),
    #[error("I/O error: {0}")]
    Io(String),
}

impl From<image_sync_core::CoreError> for CameraError {
    fn from(e: image_sync_core::CoreError) -> Self {
        use image_sync_core::CoreError as C;
        match e {
            C::Http(m) => Self::Http(m),
            C::XmlParse(m) => Self::XmlParse(m),
            C::UnrecognizedDevice(m) => Self::UnrecognizedDevice(m),
            C::Soap(m) => Self::Soap(m),
            C::JsonRpc(m) => Self::JsonRpc(m),
            C::Io(m) => Self::Io(m),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_api_round_trips_through_core_type() {
        let original = CameraApi::Dlna {
            control_url: "http://cam/control".to_string(),
            photo_root: "PhotoRoot".to_string(),
        };
        let core: image_sync_core::CameraApi = match &original {
            CameraApi::Dlna {
                control_url,
                photo_root,
            } => image_sync_core::CameraApi::Dlna {
                control_url: control_url.clone(),
                photo_root: photo_root.clone(),
            },
            CameraApi::Scalar { base_url } => image_sync_core::CameraApi::Scalar {
                base_url: base_url.clone(),
            },
        };
        let back: CameraApi = core.into();
        match back {
            CameraApi::Dlna {
                control_url,
                photo_root,
            } => {
                assert_eq!(control_url, "http://cam/control");
                assert_eq!(photo_root, "PhotoRoot");
            }
            CameraApi::Scalar { .. } => panic!("expected Dlna variant"),
        }
    }

    #[test]
    fn image_item_converts_from_core_type() {
        let core = image_sync_core::ImageItem {
            title: "t".to_string(),
            url: "u".to_string(),
            filename: "f".to_string(),
            thumbnail_url: "th".to_string(),
        };
        let ffi: ImageItem = core.into();
        assert_eq!(ffi.title, "t");
        assert_eq!(ffi.filename, "f");
    }
}
