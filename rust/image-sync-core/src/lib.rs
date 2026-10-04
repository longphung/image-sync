pub mod discovery;
pub mod dlna;
pub mod error;
pub mod scalar;
mod xml;

mod types;

pub use discovery::get_camera_info;
pub use error::CoreError;
pub use types::{CameraApi, CameraInfo, ImageItem};

pub fn ping() -> String {
    "pong from image-sync-core".to_string()
}

/// Dispatches to the DLNA or Scalar backend based on which variant of
/// `CameraApi` discovery returned.
pub fn list_images(api: &CameraApi) -> Result<Vec<ImageItem>, CoreError> {
    match api {
        CameraApi::Dlna {
            control_url,
            photo_root,
        } => dlna::list_images_dlna(control_url, photo_root),
        CameraApi::Scalar { base_url } => scalar::list_images_scalar(base_url),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_expected_string() {
        assert_eq!(ping(), "pong from image-sync-core");
    }
}
