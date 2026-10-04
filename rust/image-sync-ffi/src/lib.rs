uniffi::setup_scaffolding!();

mod types;
pub use types::{CameraApi, CameraError, CameraInfo, ImageItem};

#[uniffi::export]
pub fn ping() -> String {
    image_sync_core::ping()
}

// The core client does blocking ureq I/O. The generated JS polls these
// futures on the JS thread, so the work must run on a background thread via
// `blocking::unblock` or the app would still freeze while it's in flight.

#[uniffi::export]
pub async fn get_camera_info(host: Option<String>) -> Result<CameraInfo, CameraError> {
    blocking::unblock(move || image_sync_core::get_camera_info(host.as_deref()))
        .await
        .map(Into::into)
        .map_err(Into::into)
}

#[uniffi::export]
pub async fn list_images(api: CameraApi) -> Result<Vec<ImageItem>, CameraError> {
    let core_api: image_sync_core::CameraApi = api.into();
    blocking::unblock(move || image_sync_core::list_images(&core_api))
        .await
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}
