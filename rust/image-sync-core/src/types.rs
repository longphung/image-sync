#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageItem {
    pub title: String,
    pub url: String,
    pub filename: String,
    pub thumbnail_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CameraApi {
    Dlna {
        control_url: String,
        photo_root: String,
    },
    Scalar {
        base_url: String,
    },
}

/// Result of discovery: which API the camera speaks plus its display name
/// (UPnP `friendlyName`, falling back to `modelName`), when present.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraInfo {
    pub api: CameraApi,
    pub name: Option<String>,
}
