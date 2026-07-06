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
